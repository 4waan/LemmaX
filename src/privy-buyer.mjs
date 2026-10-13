import { createECDH, createPrivateKey, createPublicKey } from "node:crypto";
import { getAddress, recoverTypedDataAddress } from "viem";
import { RECEIVE_AUTHORIZATION_TYPES } from "./attempt.mjs";
import { deriveP256Key } from "./keys.mjs";

// The buyer's wallet is a Privy server wallet. Three P-256 authorization keys sit on the
// buyer's side:
// - principal: owns the wallet and the mandate policy (kept offline in practice);
// - agent: the AI agent's signer, limited by the mandate to one kind of signature;
// - guard: owns the set of approved quote digests; neither the agent nor LemmaX holds it.
// The agent key derives from the buyer's existing key. The principal and guard keys come
// from their own secrets (LEMMAX_PRINCIPAL_SECRET, LEMMAX_GUARD_SECRET) when set, so a
// leaked agent key gives no control over the policy or the approved set; without them they
// are derived from the buyer's key too, and the report says so.
export const PRIVY_KEY_LABELS = Object.freeze({ principal: "lemmax/privy/principal/v1", agent: "lemmax/privy/agent/v1", guard: "lemmax/privy/guard/v1" });

// Privy takes base64 DER keys: PKCS8 for private keys, SPKI for public keys.
export function p256KeyPair(scalarHex) {
  const d = Buffer.from(scalarHex.slice(2), "hex");
  const ecdh = createECDH("prime256v1"); ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const jwk = { kty: "EC", crv: "P-256", d: d.toString("base64url"), x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33, 65).toString("base64url") };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  return { privateKey: key.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64") };
}
export const PRIVY_KEY_SECRETS = Object.freeze({ principal: "LEMMAX_PRINCIPAL_SECRET", guard: "LEMMAX_GUARD_SECRET" });
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
export function buyerPrivyKeys(env) {
  const parent = env.BENCHMARK_BUYER_PRIVATE_KEY;
  if (typeof parent !== "string" || !HEX32.test(parent)) throw new TypeError("BENCHMARK_BUYER_PRIVATE_KEY is missing or is not a private key");
  return Object.fromEntries(Object.entries(PRIVY_KEY_LABELS).map(([role, label]) => {
    const name = PRIVY_KEY_SECRETS[role], own = name ? env[name] : undefined;
    if (own !== undefined && (typeof own !== "string" || !HEX32.test(own))) throw new TypeError(`${name} must be 32 bytes of hex`);
    return [role, p256KeyPair(deriveP256Key(own ?? parent, label))];
  }));
}
// Which buyer-side keys have their own secret, for reports. Names and booleans only.
export const privyKeySeparation = env => Object.fromEntries(Object.entries(PRIVY_KEY_SECRETS).map(([role, name]) => [role, Boolean(env[name])]));

// The mandate: a single ALLOW rule. The agent may sign only a USDC ReceiveWithAuthorization
// on this chain, paying the settlement contract at most the funding total, whose nonce is
// in the guard's set. LemmaX's quote digest is that nonce, so set membership pins every
// quote term. Every other method (transfers, messages, raw hashes, transactions, export,
// 7702) has no rule and is denied by default.
export function mandatePolicy({ chainId, usdc, settlement, maxValue, conditionSetId }) {
  const typed_data = { primary_type: "ReceiveWithAuthorization", types: RECEIVE_AUTHORIZATION_TYPES };
  const message = (field, operator, value) => ({ field_source: "ethereum_typed_data_message", typed_data, field, operator, value });
  return { version: "1.0", name: "LemmaX buyer mandate", chain_type: "ethereum", rules: [{
    name: "Pay only guard-approved LemmaX quotes", method: "eth_signTypedData_v4", action: "ALLOW", conditions: [
      { field_source: "ethereum_typed_data_domain", field: "chainId", operator: "eq", value: String(chainId) },
      { field_source: "ethereum_typed_data_domain", field: "verifyingContract", operator: "eq", value: getAddress(usdc) },
      message("to", "eq", getAddress(settlement)),
      message("value", "lte", String(maxValue)),
      message("nonce", "in_condition_set", conditionSetId)] }] };
}

// Condition-set items are written over REST with the owner's authorization signature; the
// SDK has no condition-set methods. Digests are stored lowercase, as Privy compares exactly.
// A request without a body (removing an item) carries no content-type: the SDK signs an
// empty body as "", and Privy checks that against a JSON content-type as {}.
export function createConditionSetClient({ appId, appSecret, ownerPrivateKey, sign, apiUrl = "https://api.privy.io", fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const auth = `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`;
  async function call(method, path, body) {
    const url = `${apiUrl}${path}`, headers = { authorization: auth, "privy-app-id": appId };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && ownerPrivateKey) {
      const expiry = String(now() + 60000);
      headers["privy-request-expiry"] = expiry;
      headers["privy-authorization-signature"] = sign({ authorizationPrivateKey: ownerPrivateKey,
        input: { version: 1, method, url, body: body ?? {}, headers: { "privy-app-id": appId, "privy-request-expiry": expiry } } });
    }
    const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) {
      let code = null;
      try { code = JSON.parse(text)?.code ?? null; } catch {}
      throw Object.assign(new Error(`Privy ${method} ${path} returned HTTP ${response.status}`), { status: response.status, code });
    }
    return text ? JSON.parse(text) : null;
  }
  return Object.freeze({
    create: (name, ownerPublicKey) => call("POST", "/v1/condition_sets", { name, owner: { public_key: ownerPublicKey } }),
    async add(setId, values) {
      const items = await call("POST", `/v1/condition_sets/${setId}/condition_set_items`, values.map(value => ({ value: String(value).toLowerCase() })));
      return Array.isArray(items) ? items : items?.items ?? [];
    },
    remove: (setId, itemId) => call("DELETE", `/v1/condition_sets/${setId}/condition_set_items/${itemId}`),
    list: setId => call("GET", `/v1/condition_sets/${setId}/condition_set_items`),
  });
}

// FiatToken's ECRecover accepts only v of 27 or 28 and low s. Normalize what the signer
// returns, then prove locally that the wallet itself signed this exact authorization.
const SECP_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
export async function normalizedSignature(typedData, signature, expectedSigner) {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new TypeError("Signer returned a malformed signature");
  let v = parseInt(signature.slice(130), 16);
  if (v === 0 || v === 1) v += 27;
  if ((v !== 27 && v !== 28) || BigInt(`0x${signature.slice(66, 130)}`) > SECP_HALF) throw new TypeError("Signer returned a non-canonical signature");
  const normalized = `${signature.slice(0, 130)}${v.toString(16)}`;
  const recovered = await recoverTypedDataAddress({ ...typedData, signature: normalized });
  if (getAddress(recovered) !== getAddress(expectedSigner)) throw new TypeError("Signature does not recover to the buyer wallet");
  return normalized;
}

// The agent's side: sign one funding authorization through Privy with the agent key only.
// Privy's TEE applies the mandate; a refusal surfaces as an error with no signature.
export function createPrivyBuyerSigner({ privy, walletId, address, agentPrivateKey }) {
  return Object.freeze({
    address: getAddress(address),
    async signFundingAuthorization(typed) {
      const typedData = { domain: { ...typed.domain, chainId: Number(typed.domain.chainId) }, types: RECEIVE_AUTHORIZATION_TYPES,
        primaryType: "ReceiveWithAuthorization", message: typed.message };
      const response = await privy.wallets().ethereum().signTypedData(walletId, {
        params: { typed_data: { domain: typedData.domain, types: typedData.types, primary_type: typedData.primaryType, message: typedData.message } },
        authorization_context: { authorization_private_keys: [agentPrivateKey] } });
      return normalizedSignature(typedData, response.signature, address);
    },
  });
}
