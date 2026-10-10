import { OUTCOMES, bindRecordToQuote, commitEvidenceDigest, hashReference, newAttemptId, normalizeQuote, quoteDigest, receiptTypedData } from "./attempt.mjs";
import { DEMO_TERMS } from "./terms.mjs";

// Runs a funded public benchmark attempt inside the evaluation boundary and signs the
// receipt. Demonstration rule: a relevance miss with valid conformance is an eligible
// failure; a conformance failure is unresolved and cannot settle, so it ends in the
// full timeout refund. Charges are the agreed per-attempt execution and evaluation charges.
export function createEvaluator({ account, domain, index, data, terms = DEMO_TERMS }) {
  return Object.freeze({
    address: account.address,
    async evaluate({ quote, record, salt, caseRef, fundedAt, chainTime }) {
      const q = normalizeQuote(quote);
      bindRecordToQuote(record, salt, q);
      if (q.evaluatorSigner !== account.address) throw new TypeError("Quote names a different evaluator");
      const query = data.queries.get(caseRef);
      if (!query || record.taskRef !== `public-demo/${caseRef}` || hashReference(query) !== record.inputDigest) throw new TypeError("Task does not match the committed record");
      const completedAt = BigInt(chainTime);
      if (completedAt < BigInt(fundedAt) || completedAt > BigInt(q.executeBy)) throw new RangeError("Outside the execution window");
      const sources = index.search({ offerRef: record.offerRef, query, requestingPrincipal: record.principalRef,
        requiredSourceVersion: record.sourceVersion.slice(2), excludeSourceRef: caseRef, limit: record.maxSources });
      const visible = new Set(data.documents.map(doc => doc.id));
      const checks = { authorized: sources.every(s => visible.has(s.sourceRef)), versionMatched: sources.every(s => `0x${s.sourceVersion}` === record.sourceVersion),
        outputLimit: sources.length <= record.maxSources, relevant: sources.some(s => data.gold.get(caseRef)?.has(s.sourceRef)) };
      const conforms = checks.authorized && checks.versionMatched && checks.outputLimit;
      const evidenceSalt = newAttemptId();
      const evidence = { sources: sources.map(s => ({ sourceRef: s.sourceRef, rank: s.rank })), checks };
      if (!conforms) return { outcome: "unresolved", evidence, receipt: null, signature: null };
      const receipt = { attemptId: q.attemptId, quoteDigest: quoteDigest(domain, q),
        evidenceCommitment: commitEvidenceDigest(hashReference(JSON.stringify(evidence)), evidenceSalt),
        outcome: checks.relevant ? OUTCOMES.success : OUTCOMES.eligible_failure,
        executionUsed: terms.executionCharge, evaluationUsed: terms.evaluationCharge, completedAt: completedAt.toString(), evaluatedAt: completedAt.toString() };
      return { outcome: checks.relevant ? "success" : "eligible_failure", evidence, evidenceSalt, receipt,
        signature: await account.signTypedData(receiptTypedData(domain, receipt)) };
    },
  });
}
