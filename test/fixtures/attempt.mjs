import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ATTEMPT_SCHEMA, SETTLEMENT_POLICY_HASH, commitAttemptRecord, hashReference, newAttemptId, quoteDigest } from "../../src/attempt.mjs";

// Placeholder token address for offline signing tests; local chain checks deploy a mock token.
export const FIXTURE_TOKEN = "0x4000000000000000000000000000000000000004";

export function attemptFixture() {
  const issuer = privateKeyToAccount(generatePrivateKey());
  const evaluator = privateKeyToAccount(generatePrivateKey());
  const buyer = privateKeyToAccount(generatePrivateKey());
  const domain = { chainId: "31337", verifyingContract: "0x1000000000000000000000000000000000000001" };
  const record = { schemaVersion: ATTEMPT_SCHEMA,
    offerRef: "fixture-retrieval/v1", outcomeSpecRef: "fixture-outcome/v1", contextRef: "fixture-context/v1",
    taskRef: "private/task-a", principalRef: "company/member-a", accessSnapshotRef: "private/acl/v1", termsRef: "fixture-terms/v1",
    inputDigest: hashReference("private query"), sourceVersion: hashReference("private corpus"),
    maxSources: 5, retryLimit: 0, executeBy: "1100", principal: "100", executionCap: "20", evaluationCap: "10" };
  const salt = newAttemptId();
  const quote = { attemptId: newAttemptId(), recordCommitment: commitAttemptRecord(record, salt), policyHash: SETTLEMENT_POLICY_HASH,
    issuer: issuer.address, buyer: buyer.address, connectorPayee: "0x2000000000000000000000000000000000000002",
    executorPayee: "0x3000000000000000000000000000000000000003", evaluatorPayee: evaluator.address, evaluatorSigner: evaluator.address,
    asset: FIXTURE_TOKEN, principal: record.principal, executionCap: record.executionCap, evaluationCap: record.evaluationCap,
    quoteExpiresAt: "1050", executeBy: record.executeBy, settleBy: "1200", timeoutMode: 1 };
  const receipt = { attemptId: quote.attemptId, quoteDigest: quoteDigest(domain, quote), evidenceCommitment: newAttemptId(),
    outcome: 1, executionUsed: "7", evaluationUsed: "3", completedAt: "1075", evaluatedAt: "1080" };
  return { issuer, evaluator, buyer, domain, record, salt, quote, receipt };
}
