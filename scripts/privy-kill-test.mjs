import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrivyClient, generateAuthorizationSignature, generateP256KeyPair } from "@privy-io/node";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RECEIVE_AUTHORIZATION_TYPES } from "../src/attempt.mjs";
import { MONAD_NETWORKS } from "../src/monad.mjs";
import { createConditionSetClient, mandatePolicy, normalizedSignature } from "../src/privy-buyer.mjs";

// Go/no-go test for the buyer mandate on a throwaway Privy wallet, before any real buyer
// funds move. It needs PRIVY_APP_ID and PRIVY_APP_SECRET, creates its own keys, signer,
// condition set, policy and wallet, and records only outcomes: no keys, no secrets.
// Every check must hold, or the mandate claim falls back (see the plan's fallback order).
const SETTLEMENT = process.env.LEMMAX_SETTLEMENT_ADDRESS ?? "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7";
const USDC = MONAD_NETWORKS.testnet.usdc, CHAIN_ID = 10143, MAX = "8000";
const digest = () => `0x${randomBytes(32).toString("hex")}`;
// Names the setup step a Privy error came from, so a stopped run says where it stopped.
const step = async (name, action) => { try { return await action(); } catch (error) { throw Object.assign(error, { step: name }); } };
const privyCode = error => error?.code ?? error?.error?.code ?? null;

async function main(env) {
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new TypeError("Set PRIVY_APP_ID and PRIVY_APP_SECRET");
  const privy = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const [principal, agent, guard] = await Promise.all([generateP256KeyPair(), generateP256KeyPair(), generateP256KeyPair()]);
  const sets = createConditionSetClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, ownerPrivateKey: guard.privateKey, sign: generateAuthorizationSignature });
  const agentSets = createConditionSetClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, ownerPrivateKey: agent.privateKey, sign: generateAuthorizationSignature });
  const quorum = await step("create the agent key quorum", () => privy.keyQuorums().create({ public_keys: [agent.publicKey], authorization_threshold: 1, display_name: "LemmaX kill-test agent" }));
  const set = await step("create the condition set", () => sets.create(`lemmax-kill-test-digests-${randomBytes(4).toString("hex")}`, guard.publicKey));
  const policy = await step("create the mandate policy", () => privy.policies().create({ ...mandatePolicy({ chainId: CHAIN_ID, usdc: USDC, settlement: SETTLEMENT, maxValue: MAX, conditionSetId: set.id }),
    owner: { public_key: principal.publicKey } }));
  const wallet = await step("create the wallet", () => privy.wallets().create({ chain_type: "ethereum", owner: { public_key: principal.publicKey },
    additional_signers: [{ signer_id: quorum.id, override_policy_ids: [policy.id] }] }));
  const asAgent = { authorization_context: { authorization_private_keys: [agent.privateKey] } };
  const typed = (message, primaryType = "ReceiveWithAuthorization", types = RECEIVE_AUTHORIZATION_TYPES) => ({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC }, types, primaryType,
    message: { from: wallet.address, to: SETTLEMENT, value: MAX, validAfter: "0", validBefore: "4102444800", nonce: digest(), ...message } });
  const signTyped = t => privy.wallets().ethereum().signTypedData(wallet.id, { params: { typed_data: { domain: t.domain, types: t.types, primary_type: t.primaryType, message: t.message } }, ...asAgent });
  const results = [];
  async function check(name, expected, action) {
    let observed, detail = null;
    try { detail = await action(); observed = "allowed"; } catch (error) {
      // Only a policy refusal from Privy (an HTTP 4xx) counts; a network error proves nothing.
      observed = Number(error.status) >= 400 && Number(error.status) < 500 ? "refused" : "error";
      detail = { status: error.status ?? null, code: privyCode(error), type: error.name ?? "Error" };
    }
    results.push({ check: name, expected, observed, pass: observed === expected, ...(observed !== "allowed" ? { refusal: detail } : {}) });
  }

  // Allowed: a listed digest, measured from the moment it is added to the first signature.
  const approved = typed({});
  const [item] = await step("add the approved digest", () => sets.add(set.id, [approved.message.nonce]));
  const added = Date.now();
  let signature = null, attempts = 0;
  while (!signature && Date.now() - added < 15000) {
    attempts++;
    try { signature = (await signTyped(approved)).signature; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  const latencyMs = Date.now() - added;
  results.push({ check: "listed digest is signed", expected: "allowed", observed: signature ? "allowed" : "refused", pass: Boolean(signature), latencyMs, attempts });
  if (signature) {
    let normalized = null;
    try { normalized = await normalizedSignature(approved, signature, wallet.address); } catch {}
    results.push({ check: "signature normalizes to v 27/28, low s, and recovers to the wallet", expected: "allowed", observed: normalized ? "allowed" : "refused",
      pass: Boolean(normalized), returnedV: parseInt(signature.slice(130), 16) });
  }
  await check("unlisted digest", "refused", () => signTyped(typed({})));
  await check("value above the funding total", "refused", () => signTyped(typed({ nonce: approved.message.nonce, value: "8001" })));
  await check("payee other than the settlement", "refused", () => signTyped(typed({ nonce: approved.message.nonce, to: privateKeyToAccount(generatePrivateKey()).address })));
  await check("TransferWithAuthorization to anyone", "refused", () => signTyped(typed({ nonce: approved.message.nonce }, "TransferWithAuthorization",
    { TransferWithAuthorization: RECEIVE_AUTHORIZATION_TYPES.ReceiveWithAuthorization })));
  await check("personal_sign", "refused", () => privy.wallets().ethereum().signMessage(wallet.id, { message: "hello", ...asAgent }));
  await check("secp256k1 hash signing", "refused", () => privy.wallets().ethereum().signSecp256k1(wallet.id, { params: { hash: `0x${"11".repeat(32)}` }, ...asAgent }));
  await check("raw hash signing", "refused", () => privy.wallets().rawSign(wallet.id, { params: { hash: `0x${"11".repeat(32)}` }, ...asAgent }));
  await check("private key export", "refused", () => privy.wallets().export(wallet.id, asAgent));
  await check("EIP-7702 authorization", "refused", () => privy.wallets().ethereum().sign7702Authorization(wallet.id, { params: { contract: USDC, chain_id: CHAIN_ID }, ...asAgent }));
  await check("agent adds its own digest to the guard's set", "refused", () => agentSets.add(set.id, [digest()]));
  await step("remove the approved digest", () => sets.remove(set.id, item.id));
  await check("digest refused after the guard removes it", "refused", async () => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return signTyped(approved);
  });
  return { schemaVersion: "privy-kill-test/v1", sdk: "@privy-io/node 0.35.0", chainId: CHAIN_ID, settlement: SETTLEMENT, usdc: USDC,
    wallet: { address: wallet.address }, passed: results.every(r => r.pass), results,
    note: "Throwaway wallet and keys created by this run; keys were held only in memory." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await main(process.env);
    const text = JSON.stringify(report, null, 2) + "\n";
    if (process.env.LEMMAX_KILL_TEST_OUTPUT) writeFileSync(process.env.LEMMAX_KILL_TEST_OUTPUT, text);
    process.stdout.write(text);
    if (!report.passed) process.exitCode = 2;
  } catch (error) {
    const where = error?.step ? ` at "${error.step}"` : "", code = privyCode(error);
    console.error(`Kill test stopped${where}: ${error instanceof TypeError ? error.message : `${error.name ?? "Error"}${error.status ? ` (HTTP ${error.status}${code ? `, ${code}` : ""})` : ""}`}`);
    process.exitCode = 1;
  }
}
