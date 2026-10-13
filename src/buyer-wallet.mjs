import { existsSync, readFileSync } from "node:fs";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RECEIVE_AUTHORIZATION_TYPES } from "./attempt.mjs";
import { buyerPrivyKeys, createConditionSetClient, createPrivyBuyerSigner, keyFingerprint, normalizedSignature } from "./privy-buyer.mjs";

// Rehearsal mandate for runs without a Privy wallet: the same single ALLOW rule the Privy
// policy holds, checked locally, and labelled as a rehearsal wherever it is reported.
export function localMandateWallet({ account, chainId, usdc, settlement, maxValue }) {
  const approved = new Set();
  const deny = reason => Object.assign(new Error(`Policy refused: ${reason}`), { status: 403, policy: true });
  return {
    conditionSets: {
      add: async (setId, values) => values.map(v => { const x = String(v).toLowerCase(); approved.add(x); return { id: x, value: x }; }),
      remove: async (setId, id) => { approved.delete(String(id).toLowerCase()); },
    },
    signer: { address: account.address, label: "local signer holding the Privy policy rule",
      async signFundingAuthorization(typed) {
        const m = typed.message;
        if (Number(typed.domain.chainId) !== Number(chainId) || getAddress(typed.domain.verifyingContract) !== getAddress(usdc)) throw deny("wrong chain or token");
        if (getAddress(m.to) !== getAddress(settlement)) throw deny("the payment does not go to the settlement contract");
        if (BigInt(m.value) > BigInt(maxValue)) throw deny("amount above the limit");
        if (!approved.has(String(m.nonce).toLowerCase())) throw deny("this bill was not approved by the guard");
        const typedData = { domain: { ...typed.domain, chainId: Number(typed.domain.chainId) }, types: RECEIVE_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message: m };
        return normalizedSignature(typedData, await account.signTypedData(typedData), account.address);
      } },
  };
}

// A refusal from the wallet, reduced to what a visitor may see: who refused and why.
export function walletRefusal(error, mode) {
  const status = Number(error?.status) || null;
  const byPolicy = error?.policy || (status >= 400 && status < 500);
  const raw = String(error?.message ?? "refused").replace(/0x[0-9a-fA-F]{64,}/g, "0x…").slice(0, 240);
  return { refused: true, by: mode === "privy" ? "Privy (wallet policy in its secure enclave)" : "wallet policy (local signer)", status, byPolicy: Boolean(byPolicy), message: raw };
}

// The buyer's signing side from its environment: the Privy server wallet whose policy signs
// only guard-approved bills when Privy is configured, otherwise the local rehearsal of that
// same policy with the benchmark buyer key. The wallet record names the fingerprints of the
// agent and guard keys it was created with; keys that differ could never sign there, so the
// local rehearsal is used and the reason is reported. Keys are read here and never returned.
export async function buyerMandate({ env, chainId, usdc, settlement, maxValue }) {
  const privyRecord = env.LEMMAX_PRIVY_BUYER_FILE ?? new URL("../deployments/privy-buyer.json", import.meta.url);
  let privyUnavailable = null;
  if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET && existsSync(privyRecord)) {
    const record = JSON.parse(readFileSync(privyRecord, "utf8")), keys = buyerPrivyKeys(env);
    const matches = ["agent", "guard"].every(role => !record.keyFingerprints?.[role] || record.keyFingerprints[role] === keyFingerprint(keys[role].publicKey));
    if (!matches) privyUnavailable = "this server's agent or guard key differs from the one the Privy wallet was created with";
  }
  if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET && existsSync(privyRecord) && !privyUnavailable) {
    const { PrivyClient, generateAuthorizationSignature } = await import("@privy-io/node");
    const record = JSON.parse(readFileSync(privyRecord, "utf8")), keys = buyerPrivyKeys(env);
    return { mode: "privy", setId: record.conditionSetId,
      signer: createPrivyBuyerSigner({ privy: new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }), walletId: record.walletId,
        address: record.address, agentPrivateKey: keys.agent.privateKey }),
      conditionSets: createConditionSetClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, ownerPrivateKey: keys.guard.privateKey, sign: generateAuthorizationSignature }) };
  }
  let account;
  try { account = privateKeyToAccount(env.BENCHMARK_BUYER_PRIVATE_KEY); } catch { throw new TypeError("BENCHMARK_BUYER_PRIVATE_KEY is missing or is not a private key"); }
  const local = localMandateWallet({ account, chainId, usdc, settlement, maxValue });
  return { mode: "local", setId: "local", signer: local.signer, conditionSets: local.conditionSets, ...(privyUnavailable ? { privyUnavailable } : {}) };
}
