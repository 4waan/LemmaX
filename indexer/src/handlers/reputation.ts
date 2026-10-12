import { indexer } from "envio";
import { FEEDBACK_TAGS, acceptanceOf, conformanceOf, decodeFeedbackUri, shareValue } from "../shared/feedback.mjs";
import { INDEX } from "../shared/rules.mjs";

// Validates LemmaX-format ERC-8004 feedback against settled attempts. Feedback from any
// client is recorded, but only a rostered issuer of that kind, a matching file hash, the
// current rulebook, settled attempts counted once and a value that matches the indexed
// outcomes make it valid. Other agents' feedback is ignored.
const KINDS = Object.fromEntries(Object.entries(FEEDBACK_TAGS).map(([kind, tag]) => [tag, kind]));

indexer.onEvent({ contract: "ReputationRegistry", event: "NewFeedback" }, async ({ event, context }) => {
  const kind = KINDS[event.params.tag1];
  if (!kind) return;
  const client = event.params.clientAddress.toLowerCase();
  const decoded = decodeFeedbackUri(event.params.feedbackURI);
  const ids: string[] = Array.isArray(decoded?.file?.attempts) ? decoded.file.attempts.map((a: { attemptId: string }) => String(a.attemptId)) : [];
  const attempts = await Promise.all(ids.map(id => context.Attempt.get(id)));
  const counted = await Promise.all(ids.map(id => context.CountedAttempt.get(`${kind}:${id}`)));
  let reason: string | undefined;
  const rostered = kind === "acceptance" ? INDEX.evaluators.has(client) : client === INDEX.issuer;
  if (!decoded || decoded.hash !== event.params.feedbackHash) reason = "file_hash_mismatch";
  else if (decoded.file.kind !== kind || decoded.file.rulebookHash !== INDEX.hash) reason = "kind_or_rulebook_mismatch";
  else if (!rostered) reason = "unrostered_client";
  else if (!ids.length || new Set(ids).size !== ids.length) reason = "no_or_duplicate_attempts";
  else if (attempts.some(a => !a || (a.state !== "settled_success" && a.state !== "settled_failure"))) reason = "attempt_not_settled";
  else if (counted.some(Boolean)) reason = "attempt_counted_twice";
  else if (kind === "acceptance" && attempts.some(a => a!.evaluatorSigner !== client)) reason = "attempt_not_attested_by_client";
  else if (kind === "conformance" && new Set(attempts.map(a => a!.evaluatorSigner)).size !== 1) reason = "mixed_evaluators";
  else {
    const rows = attempts.map(a => ({ state: a!.state, blocking: a!.blocking }));
    const share = kind === "acceptance" ? (s => shareValue(s.accepted, s.settled))(acceptanceOf(rows)) : (s => shareValue(s.conforming, s.settled))(conformanceOf(rows));
    if (BigInt(share.value) !== event.params.value || share.valueDecimals !== Number(event.params.valueDecimals)) reason = "value_mismatch";
  }
  const id = `${event.params.agentId}_${client}_${event.params.feedbackIndex}`;
  context.ReputationRecord.set({ id, agentId: event.params.agentId, client, feedbackIndex: event.params.feedbackIndex, value: event.params.value,
    valueDecimals: Number(event.params.valueDecimals), tag1: event.params.tag1, tag2: event.params.tag2, feedbackHash: event.params.feedbackHash,
    valid: !reason, reason, attemptIds: ids, revoked: false, txHash: event.transaction.hash });
  if (!reason) for (const attemptId of ids) context.CountedAttempt.set({ id: `${kind}:${attemptId}`, feedback: id });
});

indexer.onEvent({ contract: "ReputationRegistry", event: "FeedbackRevoked" }, async ({ event, context }) => {
  const id = `${event.params.agentId}_${event.params.clientAddress.toLowerCase()}_${event.params.feedbackIndex}`;
  const existing = await context.ReputationRecord.get(id);
  if (existing) context.ReputationRecord.set({ ...existing, revoked: true });
});
