import { atomic } from "./attempt.mjs";

// Agreed demonstration terms, in USDC atomic units (six decimals). Each value traces to
// a published reference price or a measured cost; see docs/Monad-Settlement-Path.md.
export const DEMO_TERMS = Object.freeze({
  termsRef: "lemmax-demo-terms/v1",
  principal: "5000",
  executionCap: "2000",
  evaluationCap: "1000",
  executionCharge: "1500",
  evaluationCharge: "800",
});
// Seconds after issue. The buyer authorization ends one second after funding closes,
// because the token rejects an authorization at its validBefore time.
export const DEADLINE_PROFILES = Object.freeze({
  "demo-standard/v1": Object.freeze({ fundingSeconds: 120, executeSeconds: 240, settleSeconds: 600 }),
  "demo-timeout/v1": Object.freeze({ fundingSeconds: 60, executeSeconds: 120, settleSeconds: 180 }),
});

export function quoteWindow(profileRef, issuedAt) {
  if (!Object.hasOwn(DEADLINE_PROFILES, profileRef)) throw new TypeError("Unknown deadline profile");
  const p = DEADLINE_PROFILES[profileRef], t = BigInt(atomic(issuedAt));
  return { quoteExpiresAt: String(t + BigInt(p.fundingSeconds)), executeBy: String(t + BigInt(p.executeSeconds)),
    settleBy: String(t + BigInt(p.settleSeconds)), authorizationValidBefore: String(t + BigInt(p.fundingSeconds) + 1n) };
}

// Operator caps arrive as decimal USDC strings such as "0.25". Parse exactly, never via floats.
export function usdcAtomic(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value)) throw new RangeError("Expected a USDC amount with at most six decimal places");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
}
export function formatUsdc(units) {
  const v = BigInt(units), whole = v / 1000000n, fraction = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

// Buyer's cost to complete the same outcome without buying, per query on the 5,183
// document public corpus. Both are published-price estimates the buyer declares.
export const BUYER_ALTERNATIVES = Object.freeze({
  "llm-reads-corpus/v1": Object.freeze({ costPerQuery: 0.194,
    basis: "About 1.94 million corpus tokens read with Claude Haiku 5.5 at $0.10 per million input tokens, in prompts under 100,000 tokens" }),
  "own-pipeline/v1": Object.freeze({ costPerQuery: 0.0024,
    basis: "Cohere Rerank 4 Fast at $2 per 1,000 searches, query embedding and vector query, plus corpus embedding spread over 100 queries" }),
});
// Operator cost per attempt at the recorded snapshot: the funding relay gas limit at
// 102 MON-gwei and $0.0248 per MON, plus measured scoring compute.
export const OPERATOR_COST_SNAPSHOT = Object.freeze({ deliveryCostPerAttempt: 0.00079, snapshotRef: "monad-gas-and-mon-price-snapshot/v1" });
