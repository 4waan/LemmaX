import { getAddress } from "viem";
import { OUTCOMES, allocateReceipt, normalizeQuote, normalizeReceipt, quoteDigest } from "./attempt.mjs";
import { ATTEMPT_STATES, SETTLEMENT_ABI, fundingTotal } from "./settlement.mjs";

const EVENTS = new Set(["AttemptCommitted", "AttemptTerms", "AttemptOutcome", "CreditWithdrawn", "CreditPaid", "PayoutDeferred", "PayoutInstructionSet"]);
const TRANSFERS = new Set(["CreditWithdrawn", "CreditPaid", "PayoutDeferred"]);
const ZERO32 = `0x${"0".repeat(64)}`;

function block(value, name) {
  if (typeof value !== "bigint" || value < 0n) throw new RangeError(`${name} must be a nonnegative bigint`);
  return value;
}
function logRecord(log) {
  const base = { eventName: log.eventName, blockNumber: log.blockNumber.toString(), blockHash: log.blockHash,
    transactionHash: log.transactionHash, logIndex: log.logIndex };
  const a = log.args;
  if (log.eventName === "AttemptCommitted") return { ...base, attemptId: a.attemptId, recordCommitment: a.recordCommitment, quoteDigest: a.quoteDigest };
  if (log.eventName === "AttemptOutcome") return { ...base, attemptId: a.attemptId, state: ATTEMPT_STATES[Number(a.state)],
    evidenceCommitment: a.evidenceCommitment, executionUsed: a.executionUsed.toString(), evaluationUsed: a.evaluationUsed.toString() };
  if (log.eventName === "AttemptTerms") return { ...base, attemptId: a.attemptId, buyer: getAddress(a.buyer), evaluatorSigner: getAddress(a.evaluatorSigner),
    quote: Object.fromEntries(Object.entries(a.quote).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) };
  if (log.eventName === "PayoutInstructionSet") return { ...base, owner: getAddress(a.owner), destination: getAddress(a.destination), bar: a.bar.toString(), nonce: a.nonce.toString() };
  return { ...base, owner: getAddress(a.owner), destination: getAddress(a.destination), amount: a.amount.toString() };
}

// Public RPC providers bound eth_getLogs ranges, so the caller supplies the range limit.
export async function readSettlementLogs({ publicClient, address, fromBlock, toBlock, maxBlockRange }) {
  block(fromBlock, "fromBlock"); block(toBlock, "toBlock");
  if (fromBlock > toBlock || block(maxBlockRange, "maxBlockRange") < 1n) throw new RangeError("Invalid log block range");
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += maxBlockRange) {
    const end = start + maxBlockRange - 1n < toBlock ? start + maxBlockRange - 1n : toBlock;
    const chunk = await publicClient.getContractEvents({ address: getAddress(address), abi: SETTLEMENT_ABI, fromBlock: start, toBlock: end, strict: true });
    logs.push(...chunk.filter(log => EVENTS.has(log.eventName)).map(logRecord));
  }
  return logs;
}

function dedupe(logs, issues) {
  const seen = new Map();
  for (const log of logs) {
    const key = `${log.transactionHash}:${log.logIndex}`;
    const text = JSON.stringify(log);
    if (!seen.has(key)) seen.set(key, { log, text });
    else if (seen.get(key).text !== text) issues.push({ issue: "conflicting_duplicate_log", key });
  }
  return [...seen.values()].map(entry => entry.log)
    .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || a.logIndex - b.logIndex);
}

function allocationFor(domain, quote, outcome) {
  if (outcome.state === "refunded_timeout") {
    const total = fundingTotal(quote).toString();
    return { connector: "0", executor: "0", evaluator: "0", buyerCredit: total, totalFunded: total };
  }
  const receipt = { attemptId: quote.attemptId, quoteDigest: quoteDigest(domain, quote), evidenceCommitment: outcome.evidenceCommitment,
    outcome: outcome.state === "settled_success" ? OUTCOMES.success : OUTCOMES.eligible_failure,
    executionUsed: outcome.executionUsed, evaluationUsed: outcome.evaluationUsed, completedAt: "0", evaluatedAt: "0" };
  return allocateReceipt({ domain, quote, receipt });
}

// Compares public settlement events with the private quotes and evaluator receipts a
// company holds. Duplicate log delivery is idempotent. Attempts that belong to other
// buyers appear only as unmatched identifiers. No private field is read from the chain.
export function reconcileAttempts({ logs, attempts, domain, onchainStates = {}, ledger = null }) {
  const issues = [];
  const ordered = dedupe(logs, issues);
  const byAttempt = new Map();
  for (const log of ordered) {
    if (!log.attemptId) continue;
    if (!byAttempt.has(log.attemptId)) byAttempt.set(log.attemptId, []);
    byAttempt.get(log.attemptId).push(log);
  }
  const expected = new Set();
  let expectedLocked = 0n;
  const results = attempts.map(({ quote, receipt = null }) => {
    const q = normalizeQuote(quote);
    expected.add(q.attemptId);
    const found = [], events = byAttempt.get(q.attemptId) ?? [];
    const committed = events.filter(e => e.eventName === "AttemptCommitted");
    // Contract v3 also publishes the quote terms at funding; they must hash to the same digest.
    const terms = events.filter(e => e.eventName === "AttemptTerms");
    if (terms.some(t => { try { return quoteDigest(domain, t.quote) !== quoteDigest(domain, q); } catch { return true; } })) found.push("terms_mismatch");
    const outcomes = events.filter(e => e.eventName === "AttemptOutcome");
    if (committed.length > 1) found.push("multiple_commitments");
    if (outcomes.length > 1) found.push("multiple_outcomes");
    const commit = committed[0] ?? null, outcome = outcomes[0] ?? null;
    if (outcome && !commit) found.push("outcome_without_commitment");
    if (commit && commit.recordCommitment !== q.recordCommitment) found.push("record_commitment_mismatch");
    if (commit && commit.quoteDigest !== quoteDigest(domain, q)) found.push("quote_digest_mismatch");
    const state = outcome ? outcome.state : commit ? "funded" : "none";
    let allocation = null;
    if (outcome) {
      if (outcome.state === "refunded_timeout" && (outcome.evidenceCommitment !== ZERO32 || outcome.executionUsed !== "0" || outcome.evaluationUsed !== "0")) found.push("timeout_with_charges");
      try { allocation = allocationFor(domain, q, outcome); } catch { found.push("allocation_invalid"); }
      if (outcome.state !== "refunded_timeout") {
        if (!receipt) found.push("receipt_unavailable");
        else {
          const r = normalizeReceipt(receipt);
          const settledAs = r.outcome === OUTCOMES.success ? "settled_success" : r.outcome === OUTCOMES.eligible_failure ? "settled_failure" : "unresolved";
          if (r.attemptId !== q.attemptId || settledAs !== outcome.state || r.evidenceCommitment !== outcome.evidenceCommitment
            || r.executionUsed !== outcome.executionUsed || r.evaluationUsed !== outcome.evaluationUsed) found.push("receipt_mismatch");
        }
      }
    }
    if (Object.hasOwn(onchainStates, q.attemptId) && onchainStates[q.attemptId] !== state) found.push("state_mismatch");
    const locked = state === "funded" ? fundingTotal(q) : 0n;
    expectedLocked += locked;
    return { attemptId: q.attemptId, state, locked: locked.toString(), allocation,
      funded: commit && { blockNumber: commit.blockNumber, transactionHash: commit.transactionHash },
      terminal: outcome && { blockNumber: outcome.blockNumber, transactionHash: outcome.transactionHash },
      issues: found };
  });
  // Money that left the contract, per owner: manual withdrawals and automatic payouts.
  // Deferred payouts stay as credit and are listed for retry.
  const withdrawals = {}, payouts = {}, deferred = [];
  const add = (table, log) => { table[log.owner] = (BigInt(table[log.owner] ?? "0") + BigInt(log.amount)).toString(); };
  for (const log of ordered) {
    if (!TRANSFERS.has(log.eventName)) continue;
    if (log.eventName === "CreditWithdrawn") add(withdrawals, log);
    else if (log.eventName === "CreditPaid") add(payouts, log);
    else deferred.push({ owner: log.owner, destination: log.destination, amount: log.amount, transactionHash: log.transactionHash });
  }
  // A deferral stays outstanding only until the owner's credit is paid or withdrawn later;
  // each owner's latest deferral is the amount still owed.
  const settledAfter = (owner, i) => ordered.slice(i + 1).some(l => l.owner === owner && (l.eventName === "CreditPaid" || l.eventName === "CreditWithdrawn"));
  const outstanding = new Map();
  ordered.forEach((log, i) => { if (log.eventName === "PayoutDeferred" && !settledAfter(log.owner, i)) outstanding.set(log.owner, { owner: log.owner, destination: log.destination, amount: log.amount, transactionHash: log.transactionHash }); });
  deferred.splice(0, deferred.length, ...outstanding.values());
  if (ledger) {
    if (!ledger.solvent) issues.push({ issue: "contract_insolvent" });
    if (BigInt(ledger.lockedFunds) < expectedLocked) issues.push({ issue: "locked_funds_below_expected" });
  }
  return { ok: !issues.length && results.every(r => !r.issues.length), attempts: results,
    expectedLocked: expectedLocked.toString(), withdrawals, payouts, deferred, issues,
    unmatchedAttemptIds: [...byAttempt.keys()].filter(id => !expected.has(id)) };
}
