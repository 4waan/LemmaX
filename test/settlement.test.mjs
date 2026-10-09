import test from "node:test";
import assert from "node:assert/strict";
import { attemptFixture } from "./fixtures/attempt.mjs";
import { newAttemptId, quoteDigest } from "../src/attempt.mjs";
import { RESERVE_BALANCE_WEI, connectMonad, dipsIntoReserve, gasLimitFor, waitForStage, MONAD_NETWORKS } from "../src/monad.mjs";
import { SETTLEMENT_ABI, fundingTotal, quoteArgs, receiptArgs } from "../src/settlement.mjs";
import { reconcileAttempts } from "../src/reconcile.mjs";
import { compileSettlement } from "../scripts/compile-settlement.mjs";
import { maskImmutables } from "../scripts/deploy-settlement.mjs";

const ZERO32 = `0x${"0".repeat(64)}`;
let logIndex = 0;
const log = (eventName, blockNumber, fields) => ({ eventName, blockNumber: String(blockNumber), blockHash: `0x${String(blockNumber).padStart(64, "0")}`,
  transactionHash: `0x${String(++logIndex).padStart(64, "a")}`, logIndex, ...fields });
const committed = (domain, q, block = 10) => log("AttemptCommitted", block, { attemptId: q.attemptId, recordCommitment: q.recordCommitment, quoteDigest: quoteDigest(domain, q) });
const outcome = (r, state, block = 12) => log("AttemptOutcome", block, { attemptId: r.attemptId, state,
  evidenceCommitment: r.evidenceCommitment, executionUsed: r.executionUsed, evaluationUsed: r.evaluationUsed });

test("Committed ABI matches the compiled settlement contract", () => {
  const artifact = compileSettlement();
  assert.deepEqual(artifact.abi, SETTLEMENT_ABI);
  assert.ok(Object.keys(artifact.standardInput.sources).includes("@openzeppelin/contracts/utils/cryptography/EIP712.sol"));
  const masked = maskImmutables(artifact.deployedBytecode, artifact.immutableReferences);
  const [first] = Object.values(artifact.immutableReferences)[0];
  assert.equal(masked.subarray(first.start, first.start + first.length).every(byte => byte === 0), true);
  assert.equal(masked.length, artifact.deployedBytecodeBytes);
});

test("Gas limits add bounded explicit headroom because Monad charges the limit", () => {
  assert.equal(gasLimitFor(100000n, 0), 100000n);
  assert.equal(gasLimitFor(100000n, 1000), 110000n);
  assert.equal(gasLimitFor(3n, 1), 4n);
  for (const bad of [[0n, 0], [100, 0], [100n, -1], [100n, 5001], [100n, 1.5], [100n, undefined]]) assert.throws(() => gasLimitFor(...bad));
});

test("Reserve-balance guard flags native spends that leave an EOA below min(balance, 10 MON)", () => {
  const R = RESERVE_BALANCE_WEI;
  assert.equal(R, 10n * 10n ** 18n);
  assert.equal(dipsIntoReserve(R + 130n, 130n), false);
  assert.equal(dipsIntoReserve(R + 129n, 130n), true);
  assert.equal(dipsIntoReserve(5n * 10n ** 18n, 1n), true);
  assert.equal(dipsIntoReserve(5n * 10n ** 18n, 0n), false);
  assert.equal(dipsIntoReserve(0n, 0n), false);
  assert.throws(() => dipsIntoReserve(1, 0n));
});

test("Network connection refuses unknown networks, implicit mainnet and missing RPC URLs before any request", async () => {
  assert.equal(MONAD_NETWORKS.testnet.chain.id, 10143);
  assert.equal(MONAD_NETWORKS.mainnet.chain.id, 143);
  await assert.rejects(connectMonad({ network: "toString", rpcUrl: "http://127.0.0.1:1" }), /local, testnet or mainnet/);
  await assert.rejects(connectMonad({ network: "mainnet", rpcUrl: "https://rpc.example" }), /explicit permission/);
  await assert.rejects(connectMonad({ network: "testnet" }), /explicit http/);
  await assert.rejects(connectMonad({ network: "testnet", rpcUrl: "file:///etc/passwd" }), /explicit http/);
});

test("Confirmation waits follow the finalized head and reject a replaced inclusion block", async () => {
  const fake = (heads, canonicalHash) => {
    let i = 0;
    return { calls: 0, async getBlock({ blockTag, blockNumber }) {
      if (blockTag === "finalized") return { number: heads[Math.min(i++, heads.length - 1)] };
      return { number: blockNumber, hash: canonicalHash };
    } };
  };
  const inclusion = { blockNumber: 100n, blockHash: "0xabc" };
  const timing = { pollMs: 1, timeoutMs: 1000 };
  assert.deepEqual(await waitForStage(fake([0n], "0xabc"), inclusion, "included", timing), { stage: "included", blockNumber: 100n, finalizedHead: null });
  assert.equal((await waitForStage(fake([98n, 99n, 100n], "0xabc"), inclusion, "finalized", timing)).finalizedHead, 100n);
  assert.equal((await waitForStage(fake([100n, 102n, 103n], "0xabc"), inclusion, "verified", timing)).finalizedHead, 103n);
  await assert.rejects(waitForStage(fake([100n], "0xdef"), inclusion, "finalized", timing), /no longer canonical/);
  await assert.rejects(waitForStage(fake([1n], "0xabc"), inclusion, "finalized", { pollMs: 1, timeoutMs: 5 }), /Timed out/);
  await assert.rejects(waitForStage(fake([1n], "0xabc"), inclusion, "safe", timing), /Unknown confirmation stage/);
});

test("Contract arguments preserve exact integer amounts and the signed funding total", () => {
  const { quote, receipt } = attemptFixture();
  const big = { ...quote, principal: ((1n << 255n)).toString(), executionCap: "1", evaluationCap: "2" };
  assert.equal(quoteArgs(big).principal, 1n << 255n);
  assert.equal(fundingTotal(big), (1n << 255n) + 3n);
  assert.equal(receiptArgs(receipt).completedAt, 1075n);
  assert.throws(() => quoteArgs({ ...quote, principal: 100 }));
  assert.throws(() => receiptArgs({ ...receipt, extra: 1 }));
});

test("Reconciliation matches private quotes and receipts with settlement events", () => {
  const { domain, quote, receipt } = attemptFixture();
  const failed = { ...attemptFixture(), domain };
  const q2 = { ...failed.quote }, r2 = { ...failed.receipt, quoteDigest: quoteDigest(domain, failed.quote), outcome: 2 };
  const q3 = { ...attemptFixture().quote }, q4 = { ...attemptFixture().quote };
  const logs = [committed(domain, quote), outcome(receipt, "settled_success"), committed(domain, q2), outcome(r2, "settled_failure"),
    committed(domain, q3), outcome({ attemptId: q3.attemptId, evidenceCommitment: ZERO32, executionUsed: "0", evaluationUsed: "0" }, "refunded_timeout"),
    committed(domain, q4), log("CreditWithdrawn", 20, { owner: quote.buyer, destination: quote.buyer, amount: "20" }),
    committed(domain, { ...attemptFixture().quote })];
  const result = reconcileAttempts({ logs: [...logs, logs[0], logs[1]], domain, ledger: { solvent: true, lockedFunds: "130" },
    attempts: [{ quote, receipt }, { quote: q2, receipt: r2 }, { quote: q3 }, { quote: q4 }],
    onchainStates: { [quote.attemptId]: "settled_success", [q4.attemptId]: "funded" } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.attempts.map(a => a.state), ["settled_success", "settled_failure", "refunded_timeout", "funded"]);
  assert.deepEqual(result.attempts[0].allocation, { connector: "100", executor: "7", evaluator: "3", buyerCredit: "20", totalFunded: "130" });
  assert.deepEqual(result.attempts[1].allocation, { connector: "0", executor: "7", evaluator: "3", buyerCredit: "120", totalFunded: "130" });
  assert.equal(result.attempts[2].allocation.buyerCredit, "130");
  assert.equal(result.expectedLocked, "130");
  assert.equal(result.unmatchedAttemptIds.length, 1);
  assert.deepEqual(result.withdrawals, { [quote.buyer]: "20" });
});

test("Reconciliation reports mismatched bindings, receipts, states and ledger gaps", () => {
  const { domain, quote, receipt } = attemptFixture();
  const check = (logs, extra = {}) => reconcileAttempts({ logs, domain, attempts: [{ quote, receipt }], ...extra });
  const issues = (logs, extra) => check(logs, extra).attempts[0].issues;
  assert.deepEqual(issues([{ ...committed(domain, quote), recordCommitment: newAttemptId() }]), ["record_commitment_mismatch"]);
  assert.deepEqual(issues([{ ...committed(domain, quote), quoteDigest: newAttemptId() }]), ["quote_digest_mismatch"]);
  assert.deepEqual(issues([committed(domain, quote), outcome({ ...receipt, executionUsed: "8" }, "settled_success")]), ["receipt_mismatch"]);
  assert.deepEqual(issues([committed(domain, quote), outcome(receipt, "settled_failure")]), ["receipt_mismatch"]);
  assert.deepEqual(issues([committed(domain, quote), outcome({ ...receipt, executionUsed: "21" }, "settled_success")]), ["allocation_invalid", "receipt_mismatch"]);
  assert.deepEqual(issues([outcome(receipt, "settled_success")]), ["outcome_without_commitment"]);
  assert.deepEqual(issues([committed(domain, quote), outcome(receipt, "settled_success"), outcome(receipt, "settled_success")]), ["multiple_outcomes"]);
  assert.deepEqual(issues([committed(domain, quote)], { onchainStates: { [quote.attemptId]: "settled_success" } }), ["state_mismatch"]);
  assert.deepEqual(reconcileAttempts({ logs: [committed(domain, quote), outcome(receipt, "settled_success")], domain, attempts: [{ quote }] }).attempts[0].issues, ["receipt_unavailable"]);
  assert.deepEqual(issues([committed(domain, quote), outcome({ attemptId: quote.attemptId, evidenceCommitment: ZERO32, executionUsed: "1", evaluationUsed: "0" }, "refunded_timeout")]), ["timeout_with_charges"]);
  const funded = committed(domain, quote);
  assert.deepEqual(check([funded, { ...funded, quoteDigest: newAttemptId() }]).issues, [{ issue: "conflicting_duplicate_log", key: `${funded.transactionHash}:${funded.logIndex}` }]);
  assert.deepEqual(check([funded], { ledger: { solvent: false, lockedFunds: "129" } }).issues.map(i => i.issue), ["contract_insolvent", "locked_funds_below_expected"]);
  assert.equal(check([]).attempts[0].state, "none");
});
