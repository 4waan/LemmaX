import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { MONAD_NETWORKS } from "../src/monad.mjs";
import { loadSciFact, createSciFactIndex, SCIFACT_PROFILE } from "../src/scifact.mjs";
import { loadRetrievalReport } from "../scripts/verify-retrieval.mjs";
import { ATTEMPT_SCHEMA, SETTLEMENT_POLICY_HASH, OUTCOMES, newAttemptId, hashReference,
  sealAttemptRecord, openAttemptRecord, commitEvidenceDigest, quoteTypedData, quoteDigest,
  receiptTypedData, verifyQuote, verifyReceipt, allocateReceipt, fundingAuthorizationTypedData } from "../src/attempt.mjs";

const report = loadRetrievalReport();
const data = loadSciFact(process.env.LEMMAX_SCIFACT_DIR);
const index = createSciFactIndex(data);
const issuer = privateKeyToAccount(generatePrivateKey()), evaluator = privateKeyToAccount(generatePrivateKey()), buyer = privateKeyToAccount(generatePrivateKey());
const key = randomBytes(32);
// Monad Testnet USDC and its signing domain; the settlement address is an undeployed placeholder.
const domain = { chainId: "10143", verifyingContract: "0x1000000000000000000000000000000000000001" };
const token = { name: "USDC", version: "2", chainId: "10143", verifyingContract: MONAD_NETWORKS.testnet.usdc };
const offerRef = report.offers[0].offerRef;
const examples = [];
for (const success of [true, false]) {
  const selected = report.perCase.find(row => row.outputs[offerRef].success === success);
  const started = Math.floor(Date.now() / 1000);
  const record = { schemaVersion: ATTEMPT_SCHEMA, offerRef, outcomeSpecRef: "public-labeled-relevant-source-at5/v1",
    contextRef: SCIFACT_PROFILE.profileRef, taskRef: `private-public-demo/${selected.caseRef}`,
    principalRef: SCIFACT_PROFILE.principalRef, accessSnapshotRef: "public-demo-authorization/v1", termsRef: "illustrative-attempt-terms/v1",
    inputDigest: hashReference(data.queries.get(selected.caseRef)), sourceVersion: `0x${SCIFACT_PROFILE.corpusSha256}`,
    maxSources: 5, retryLimit: 0, executeBy: String(started + 60), principal: "100", executionCap: "20", evaluationCap: "10" };
  const encrypted = sealAttemptRecord(record, key);
  const quote = { attemptId: newAttemptId(), recordCommitment: encrypted.commitment, policyHash: SETTLEMENT_POLICY_HASH,
    issuer: issuer.address, buyer: buyer.address, connectorPayee: issuer.address, executorPayee: issuer.address,
    evaluatorPayee: evaluator.address, evaluatorSigner: evaluator.address, asset: token.verifyingContract,
    principal: record.principal, executionCap: record.executionCap, evaluationCap: record.evaluationCap,
    quoteExpiresAt: String(started + 30), executeBy: record.executeBy, settleBy: String(started + 120), timeoutMode: 1 };
  const quoteSignature = await issuer.signTypedData(quoteTypedData(domain, quote));
  if (!await verifyQuote({ domain, quote, signature: quoteSignature, approvedIssuer: issuer.address, now: String(started) })) throw new Error("Quote verification failed");
  const authorization = fundingAuthorizationTypedData({ token, domain, quote, validAfter: "0", validBefore: String(started + 31) });
  const buyerSigned = await recoverTypedDataAddress({ ...authorization, signature: await buyer.signTypedData(authorization) }) === buyer.address;
  const opened = openAttemptRecord(encrypted, key, quote.recordCommitment);
  const sources = index.search({ offerRef, query: data.queries.get(selected.caseRef), requestingPrincipal: opened.principalRef,
    requiredSourceVersion: opened.sourceVersion.slice(2), excludeSourceRef: selected.caseRef });
  const allowed = new Set(data.documents.map(doc => doc.id));
  const checks = { authorized: sources.every(s => allowed.has(s.sourceRef)), versionMatched: sources.every(s => `0x${s.sourceVersion}` === opened.sourceVersion),
    outputLimit: sources.length <= opened.maxSources, relevant: sources.some(s => data.gold.get(selected.caseRef).has(s.sourceRef)) };
  if (!checks.authorized || !checks.versionMatched || !checks.outputLimit) throw new Error("Conformance failed");
  const completed = String(Math.floor(Date.now() / 1000));
  const receipt = { attemptId: quote.attemptId, quoteDigest: quoteDigest(domain, quote),
    evidenceCommitment: commitEvidenceDigest(hashReference(JSON.stringify({ sources, checks })), newAttemptId()),
    outcome: checks.relevant ? OUTCOMES.success : OUTCOMES.eligible_failure,
    executionUsed: "7", evaluationUsed: "3", completedAt: completed, evaluatedAt: completed };
  const receiptSignature = await evaluator.signTypedData(receiptTypedData(domain, receipt));
  const verified = await verifyReceipt({ domain, quote, receipt, signature: receiptSignature, fundedAt: String(started), now: completed });
  if (!verified) throw new Error("Receipt verification failed");
  examples.push({ attemptId: quote.attemptId, recordCommitment: quote.recordCommitment, encryptedRecordBytes: encrypted.ciphertext.length / 2,
    outcome: checks.relevant ? "success" : "eligible_failure", signatureVerified: verified, buyerAuthorizationVerified: buyerSigned,
    allocation: allocateReceipt({ domain, quote, receipt }) });
}
console.log(JSON.stringify({ warning: "Actual public retrieval cases, ephemeral in-memory keys, illustrative atomic USDC charges. The buyer authorization is signed but never submitted; no contract is deployed and no funds move. Relevance-only failure with valid conformance is the demo eligibility rule, not a selected company policy.",
  schemaVersion: "signed-attempt-demo/v2", examples }, null, 2));
