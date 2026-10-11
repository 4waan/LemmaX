import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_PAYOUT, SETTLEMENT_POLICY_HASH, TIMEOUT_MODES } from "../src/attempt.mjs";
import { DEADLINE_PROFILES, DEMO_TERMS } from "../src/terms.mjs";
import { RULEBOOK, RULEBOOK_HASH, RULEBOOK_INDEX, admission, canonicalJson, outcomeVerdicts, publicAllocation, quoteVerdicts } from "../src/rulebook.mjs";

const roles = RULEBOOK.roles;
const [mainEvaluator, evaluatorB] = roles.evaluators;
// An honest quote under the published terms, issued at time 1000 under the standard profile.
const honest = (changes = {}) => ({ attemptId: `0x${"01".repeat(32)}`, recordCommitment: `0x${"02".repeat(32)}`, policyHash: SETTLEMENT_POLICY_HASH,
  issuer: roles.issuer.address, buyer: "0x2B62DaD005E9342A11C651C236bbdE7AfBa64681", connectorPayee: roles.connectors[0].address,
  executorPayee: roles.executor.address, evaluatorPayee: mainEvaluator.payee, evaluatorSigner: mainEvaluator.signer, asset: RULEBOOK.asset,
  principal: "5000", executionCap: "2000", evaluationCap: "1000", quoteExpiresAt: "1120", executeBy: "1240", settleBy: "1600",
  timeoutMode: TIMEOUT_MODES.refund_all, ...changes });
const codes = verdicts => verdicts.map(v => `${v.code}:${v.severity}`);

test("The published rulebook matches the agreed terms and its indexer copy byte for byte", () => {
  assert.equal(readFileSync(new URL("../rulebook/lemmax-rulebook-v1.json", import.meta.url), "utf8"),
    readFileSync(new URL("../indexer/src/shared/lemmax-rulebook-v1.json", import.meta.url), "utf8"));
  for (const key of ["termsRef", "principal", "executionCap", "evaluationCap", "executionCharge", "evaluationCharge"]) assert.equal(RULEBOOK.terms[key], DEMO_TERMS[key]);
  for (const [ref, p] of Object.entries(DEADLINE_PROFILES)) assert.deepEqual(RULEBOOK.profiles[ref],
    { fundingSeconds: p.fundingSeconds, executeAfterFunding: p.executeSeconds - p.fundingSeconds, settleAfterFunding: p.settleSeconds - p.fundingSeconds });
  assert.equal(RULEBOOK.payouts.minimum, MIN_PAYOUT);
  assert.match(RULEBOOK_HASH, /^0x[0-9a-f]{64}$/);
  assert.equal(canonicalJson({ b: [2, { d: 1, c: 0 }], a: "x" }), '{"a":"x","b":[2,{"c":0,"d":1}]}');
});

test("Quote verdicts flag off-terms quotes, off-profile deadlines, unrostered or self evaluators and operator income", () => {
  assert.deepEqual(quoteVerdicts(honest(), RULEBOOK_INDEX), []);
  assert.deepEqual(quoteVerdicts(honest({ quoteExpiresAt: "1060", executeBy: "1120", settleBy: "1180" }), RULEBOOK_INDEX), []);
  assert.deepEqual(codes(quoteVerdicts(honest({ evaluatorSigner: roles.issuer.address }), RULEBOOK_INDEX)), ["unregistered_or_self_evaluator:blocking"]);
  assert.deepEqual(codes(quoteVerdicts(honest({ evaluatorSigner: "0x1000000000000000000000000000000000000001" }), RULEBOOK_INDEX)), ["unregistered_or_self_evaluator:blocking"]);
  assert.deepEqual(codes(quoteVerdicts(honest({ evaluatorSigner: evaluatorB.signer }), RULEBOOK_INDEX)), ["off_terms:recorded"]);
  assert.deepEqual(quoteVerdicts(honest({ evaluatorSigner: evaluatorB.signer, evaluatorPayee: evaluatorB.payee }), RULEBOOK_INDEX), []);
  assert.deepEqual(codes(quoteVerdicts(honest({ settleBy: "1700" }), RULEBOOK_INDEX)), ["off_profile:recorded"]);
  assert.deepEqual(codes(quoteVerdicts(honest({ principal: "1000", executionCap: "6000" }), RULEBOOK_INDEX)), ["off_terms:recorded"]);
  assert.deepEqual(codes(quoteVerdicts(honest({ connectorPayee: roles.issuer.address }), RULEBOOK_INDEX)), ["off_terms:recorded", "operator_income:recorded"]);
  assert.ok(quoteVerdicts(honest({ evaluatorSigner: roles.issuer.address }), RULEBOOK_INDEX).every(v => v.party === roles.issuer.address.toLowerCase() && v.rulebookHash === RULEBOOK_HASH));
});

test("Outcome verdicts hold the quote's evaluator to the tariff and allocations follow the public terms", () => {
  const q = honest({ evaluatorSigner: evaluatorB.signer, evaluatorPayee: evaluatorB.payee });
  const settled = (state, executionUsed, evaluationUsed) => ({ state, executionUsed, evaluationUsed });
  assert.deepEqual(outcomeVerdicts(q, settled("settled_success", "1500", "800"), RULEBOOK_INDEX), []);
  const over = outcomeVerdicts(q, settled("settled_success", "1500", "1000"), RULEBOOK_INDEX);
  assert.deepEqual([codes(over), over[0].party], [["above_tariff:blocking"], evaluatorB.signer.toLowerCase()]);
  assert.deepEqual(codes(outcomeVerdicts(q, settled("settled_failure", "1000", "800"), RULEBOOK_INDEX)), ["below_tariff:informational"]);
  assert.deepEqual(outcomeVerdicts(q, settled("refunded_timeout", "0", "0"), RULEBOOK_INDEX), []);
  assert.deepEqual(publicAllocation(q, settled("settled_success", "1500", "800")), { connector: "5000", executor: "1500", evaluator: "800", buyer: "700", total: "8000" });
  assert.deepEqual(publicAllocation(q, settled("settled_failure", "1500", "800")), { connector: "0", executor: "1500", evaluator: "800", buyer: "5700", total: "8000" });
  assert.deepEqual(publicAllocation(q, settled("refunded_timeout", "0", "0")), { connector: "0", executor: "0", evaluator: "0", buyer: "8000", total: "8000" });
});

test("Admission fails closed on a stale index, a flagged party or a blocking quote verdict", () => {
  const q = honest();
  assert.deepEqual(admission({ quote: q, index: RULEBOOK_INDEX, records: {}, indexLagBlocks: 3 }), { admit: true, reasons: [] });
  assert.deepEqual(admission({ quote: q, index: RULEBOOK_INDEX, records: {}, indexLagBlocks: 31 }).reasons, ["index_stale"]);
  assert.deepEqual(admission({ quote: q, index: RULEBOOK_INDEX, records: {}, indexLagBlocks: undefined }).reasons, ["index_stale"]);
  const flagged = { [mainEvaluator.signer.toLowerCase()]: { blocking: 1, rulebookHash: RULEBOOK_HASH } };
  assert.deepEqual(admission({ quote: q, index: RULEBOOK_INDEX, records: flagged, indexLagBlocks: 0 }).reasons, ["evaluator_flagged"]);
  const otherRulebook = { [mainEvaluator.signer.toLowerCase()]: { blocking: 1, rulebookHash: `0x${"00".repeat(32)}` } };
  assert.equal(admission({ quote: q, index: RULEBOOK_INDEX, records: otherRulebook, indexLagBlocks: 0 }).admit, true);
  assert.deepEqual(admission({ quote: honest({ evaluatorSigner: roles.issuer.address }), index: RULEBOOK_INDEX, records: {}, indexLagBlocks: 0 }).reasons, ["unregistered_or_self_evaluator"]);
});
