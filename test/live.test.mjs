import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createLimiter, createState, localMandateWallet, pickClaims, receiptFrom, walletRefusal } from "../web/live.mjs";

const SETTLEMENT = "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7", USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

test("Claims mix searches the offer finds with ones it misses, short enough to read", () => {
  const offerRef = "o/v1";
  const row = (caseRef, success, representative = true) => ({ caseRef, representative, outputs: { [offerRef]: { success } } });
  const report = { perCase: [row("1", true), row("2", false), row("3", true), row("4", true, false), row("5", true), row("6", false), row("7", true), row("8", true)] };
  const data = { queries: new Map([["1", "a"], ["2", "b"], ["3", "c"], ["4", "d"], ["5", "x".repeat(200)], ["6", "f"], ["7", "g"], ["8", "h"]]) };
  const claims = pickClaims({ report, data, offerRef });
  assert.deepEqual(claims.map(c => [c.caseRef, c.expected]), [["1", "found"], ["3", "found"], ["7", "found"], ["8", "found"], ["2", "missed"], ["6", "missed"]]);
});

test("The receipt separates what each party earned, what was paid now and what is still owed", () => {
  const quote = { principal: "5000", executionCap: "1500", evaluationCap: "1500", buyer: "0x2B62DaD005E9342A11C651C236bbdE7AfBa64681",
    connectorPayee: "0xA936E7e3A1A1B5E2C3b0f1b8b3E2F8a6A5aa0c9c", executorPayee: "0xeD09e99F20cEEd22BFff0D465f5A61d061b36e05", evaluatorPayee: "0xd059A60Cf6Cc3fD83002389f2128cFB6F1c70a77" };
  const tx = `0x${"ab".repeat(32)}`;
  const logs = [{ transactionHash: tx, eventName: "CreditPaid", owner: quote.connectorPayee, amount: "10000" }];
  const success = receiptFrom({ logs, txHash: tx, quote, outcome: { state: "settled_success", executionUsed: "1500", evaluationUsed: "800" },
    credits: { [quote.executorPayee]: "1500" }, names: {} });
  assert.deepEqual(success.map(p => [p.role, p.earned, p.paidNow, p.creditOwed]), [
    ["provider", "0.005", "0.01", "0"], ["LemmaX (execution)", "0.0015", "0", "0.0015"], ["checker", "0.0008", "0", "0"], ["buyer (returned)", "0.0007", "0", "0"]]);
  const miss = receiptFrom({ logs: [], txHash: tx, quote, outcome: { state: "settled_failure", executionUsed: "1500", evaluationUsed: "800" }, credits: {}, names: {} });
  assert.deepEqual(miss.map(p => [p.role, p.earned]), [["LemmaX (execution)", "0.0015"], ["checker", "0.0008"], ["buyer (returned)", "0.0057"]]);
});

test("Per-visitor limits slide, and daily counters survive a restart", () => {
  let now = 0;
  const limit = createLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limit("a").ok, true); assert.equal(limit("a").ok, true);
  const blocked = limit("a");
  assert.deepEqual([blocked.ok, blocked.retryInMs], [false, 1000]);
  assert.equal(limit("b").ok, true);
  now = 1001; assert.equal(limit("a").ok, true);
  const dir = mkdtempSync(join(tmpdir(), "lemmax-state-"));
  try {
    const first = createState(dir);
    first.day(20000).buys = 7; first.save();
    assert.equal(createState(dir).day(20000).buys, 7);
    const memory = createState(null);
    memory.day(1).buys = 3; memory.save();
    assert.equal(createState(null).day(1).buys, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("The rehearsal wallet holds the same single rule as the Privy policy", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = localMandateWallet({ account, chainId: 10143, usdc: USDC, settlement: SETTLEMENT, maxValue: 8000n });
  const nonce = `0x${"11".repeat(32)}`;
  const typed = (message = {}, domain = {}) => ({ domain: { name: "USDC", version: "2", chainId: "10143", verifyingContract: USDC, ...domain },
    message: { from: account.address, to: SETTLEMENT, value: "8000", validAfter: "0", validBefore: "4102444800", nonce, ...message } });
  await assert.rejects(wallet.signer.signFundingAuthorization(typed()), /not approved by the guard/);
  await wallet.conditionSets.add("local", [nonce.toUpperCase().replace("0X", "0x")]);
  assert.match(await wallet.signer.signFundingAuthorization(typed()), /^0x[0-9a-f]{130}$/);
  await assert.rejects(wallet.signer.signFundingAuthorization(typed({ to: account.address })), /does not go to the settlement contract/);
  await assert.rejects(wallet.signer.signFundingAuthorization(typed({ value: "8001" })), /above the limit/);
  await assert.rejects(wallet.signer.signFundingAuthorization(typed({}, { chainId: "1" })), /wrong chain or token/);
  await wallet.conditionSets.remove("local", nonce);
  await assert.rejects(wallet.signer.signFundingAuthorization(typed()), /not approved/);
  const shown = walletRefusal(Object.assign(new Error(`policy denied for nonce 0x${"ab".repeat(32)}`), { status: 400 }), "privy");
  assert.deepEqual([shown.refused, shown.status, shown.byPolicy, shown.message], [true, 400, true, "policy denied for nonce 0x…"]);
  assert.match(shown.by, /Privy/);
});
