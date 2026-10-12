import { getAddress } from "viem";
import { FEEDBACK_SCHEMA, FEEDBACK_TAGS, acceptanceOf, conformanceOf, encodeFeedbackFile, shareValue } from "../indexer/src/shared/feedback.mjs";
import { RULEBOOK_HASH, RULEBOOK_INDEX, outcomeVerdicts, quoteVerdicts } from "./rulebook.mjs";

// Builds LemmaX's batched ERC-8004 feedback from public settlement data only. Two kinds:
// - acceptance: an evaluator reports, to the Provider agent, how many of the settled
//   attempts it attested were accepted (descriptive, not a probability);
// - conformance: the quote issuer reports, to an evaluator agent, how many of that
//   evaluator's settled attempts followed the published rulebook.
// Timeouts are excluded, attempts already counted in earlier feedback are skipped, and the
// file carries attempt IDs and settlement transactions only.

// Public attempts from settlement events: AttemptTerms gives the terms, AttemptOutcome the result.
export function attemptsFromLogs(logs) {
  const byId = new Map();
  for (const log of logs) {
    if (log.eventName === "AttemptTerms") byId.set(log.attemptId, { ...byId.get(log.attemptId), attemptId: log.attemptId, quote: log.quote });
    if (log.eventName === "AttemptOutcome") byId.set(log.attemptId, { ...byId.get(log.attemptId), attemptId: log.attemptId, state: log.state,
      executionUsed: log.executionUsed, evaluationUsed: log.evaluationUsed, settleTx: log.transactionHash, settleBlock: log.blockNumber });
  }
  return [...byId.values()].filter(a => a.quote && a.state).map(a => {
    const verdicts = [...quoteVerdicts(a.quote, RULEBOOK_INDEX), ...outcomeVerdicts(a.quote, a, RULEBOOK_INDEX)];
    return { ...a, evaluatorSigner: getAddress(a.quote.evaluatorSigner), connectorPayee: getAddress(a.quote.connectorPayee),
      blocking: verdicts.some(v => v.severity === "blocking"), verdicts: verdicts.map(v => v.code) };
  });
}

export function buildFeedback({ kind, giver, subject, attempts, counted = new Set(), window }) {
  if (!FEEDBACK_TAGS[kind]) throw new TypeError("Unknown feedback kind");
  const eligible = attempts.filter(a => (a.state === "settled_success" || a.state === "settled_failure") && !counted.has(`${kind}:${a.attemptId}`)
    && (kind === "acceptance" ? a.evaluatorSigner === getAddress(giver) && a.connectorPayee === getAddress(subject.payee) : a.evaluatorSigner === getAddress(subject.signer)));
  if (!eligible.length) return null;
  const counts = kind === "acceptance" ? acceptanceOf(eligible) : conformanceOf(eligible);
  const share = kind === "acceptance" ? shareValue(counts.accepted, counts.settled) : shareValue(counts.conforming, counts.settled);
  const file = { schemaVersion: FEEDBACK_SCHEMA, kind, rulebookHash: RULEBOOK_HASH, subject: { agentId: String(subject.agentId), role: subject.role },
    window, counts, attempts: eligible.map(a => ({ attemptId: a.attemptId, settleTx: a.settleTx })) };
  const { uri, hash } = encodeFeedbackFile(file);
  return { kind, agentId: BigInt(subject.agentId), giver: getAddress(giver), value: BigInt(share.value), valueDecimals: share.valueDecimals,
    tag1: FEEDBACK_TAGS[kind], tag2: "lemmax-rulebook/v1", endpoint: "", feedbackURI: uri, feedbackHash: hash, file,
    line: `${kind} -> agent ${subject.agentId} (${subject.role}): ${kind === "acceptance" ? `${counts.accepted} of ${counts.settled} accepted` : `${counts.conforming} of ${counts.settled} conforming`}` };
}

// Attempts already counted, from LemmaX feedback already on chain (decoded data URIs).
export function countedFromFeedback(files) {
  return new Set(files.flatMap(f => (f?.attempts ?? []).map(a => `${f.kind}:${a.attemptId}`)));
}
