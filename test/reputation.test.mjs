import test from "node:test";
import assert from "node:assert/strict";
import { RULEBOOK } from "../src/rulebook.mjs";
import { attemptsFromLogs, buildFeedback, countedFromFeedback } from "../src/reputation.mjs";
import { decodeFeedbackUri } from "../indexer/src/shared/feedback.mjs";

const roles = RULEBOOK.roles, [main, b] = roles.evaluators, provider = roles.connectors[0].address;
const id = n => `0x${n.toString(16).padStart(64, "0")}`;
const quote = (n, evaluator) => ({ attemptId: id(n), recordCommitment: id(100 + n), policyHash: id(200), issuer: roles.issuer.address, buyer: "0x2B62DaD005E9342A11C651C236bbdE7AfBa64681",
  connectorPayee: provider, executorPayee: roles.executor.address, evaluatorPayee: evaluator.payee, evaluatorSigner: evaluator.signer, asset: RULEBOOK.asset,
  principal: "5000", executionCap: "2000", evaluationCap: "1000", quoteExpiresAt: "1120", executeBy: "1240", settleBy: "1600", timeoutMode: 1 });
const logs = [
  { eventName: "AttemptTerms", attemptId: id(1), quote: quote(1, main) }, { eventName: "AttemptOutcome", attemptId: id(1), state: "settled_success", executionUsed: "1500", evaluationUsed: "800", transactionHash: "0x01", blockNumber: "10" },
  { eventName: "AttemptTerms", attemptId: id(2), quote: quote(2, main) }, { eventName: "AttemptOutcome", attemptId: id(2), state: "settled_failure", executionUsed: "1500", evaluationUsed: "800", transactionHash: "0x02", blockNumber: "11" },
  { eventName: "AttemptTerms", attemptId: id(3), quote: quote(3, main) }, { eventName: "AttemptOutcome", attemptId: id(3), state: "refunded_timeout", executionUsed: "0", evaluationUsed: "0", transactionHash: "0x03", blockNumber: "12" },
  { eventName: "AttemptTerms", attemptId: id(4), quote: quote(4, b) }, { eventName: "AttemptOutcome", attemptId: id(4), state: "settled_success", executionUsed: "1500", evaluationUsed: "1000", transactionHash: "0x04", blockNumber: "13" },
  { eventName: "AttemptTerms", attemptId: id(5), quote: quote(5, main) },
];
const window = { fromBlock: "1", toBlock: "20" };

test("Feedback restates settled public outcomes: acceptance excludes timeouts, conformance follows the rulebook", () => {
  const attempts = attemptsFromLogs(logs);
  assert.deepEqual(attempts.map(a => [a.attemptId, a.state, a.blocking]), [[id(1), "settled_success", false], [id(2), "settled_failure", false],
    [id(3), "refunded_timeout", false], [id(4), "settled_success", true]]);
  const acceptance = buildFeedback({ kind: "acceptance", giver: main.signer, subject: { agentId: "2110", role: "provider", payee: provider }, attempts, window });
  assert.deepEqual([acceptance.line, acceptance.value, acceptance.valueDecimals, acceptance.tag1], ["acceptance -> agent 2110 (provider): 1 of 2 accepted", 5000n, 2, "lemmax/acceptance/v1"]);
  const decoded = decodeFeedbackUri(acceptance.feedbackURI);
  assert.equal(decoded.hash, acceptance.feedbackHash);
  assert.deepEqual(decoded.file.attempts.map(a => a.attemptId), [id(1), id(2)]);
  assert.doesNotMatch(acceptance.feedbackURI + JSON.stringify(decoded.file), /offerRef|caseRef|taskRef|bm25|tfidf/i);
  const conformanceB = buildFeedback({ kind: "conformance", giver: roles.issuer.address, subject: { agentId: "2109", role: "evaluatorB", signer: b.signer }, attempts, window });
  assert.deepEqual([conformanceB.line, conformanceB.value], ["conformance -> agent 2109 (evaluatorB): 0 of 1 conforming", 0n]);
  const conformanceMain = buildFeedback({ kind: "conformance", giver: roles.issuer.address, subject: { agentId: "2108", role: "evaluator", signer: main.signer }, attempts, window });
  assert.equal(conformanceMain.line, "conformance -> agent 2108 (evaluator): 2 of 2 conforming");
  // Attempts already counted on chain are never counted again.
  const counted = countedFromFeedback([decoded.file]);
  assert.equal(buildFeedback({ kind: "acceptance", giver: main.signer, subject: { agentId: "2110", role: "provider", payee: provider }, attempts, counted, window }), null);
  assert.throws(() => buildFeedback({ kind: "quality", giver: main.signer, subject: {}, attempts, window }), /Unknown feedback kind/);
});
