import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { attemptFixture } from "./fixtures/attempt.mjs";
import { atomic, attemptRecordHash, bindRecordToQuote, commitAttemptRecord, commitEvidenceDigest, newAttemptId,
  normalizeAttemptRecord, normalizeQuote, normalizeReceipt, sealAttemptRecord, openAttemptRecord,
  quoteTypedData, receiptTypedData, verifyQuote, verifyReceipt, allocateReceipt, allocateTimeout } from "../src/attempt.mjs";

test("Private commitments are stable across key order and change with every bound field or salt", () => {
  const { record, salt, quote } = attemptFixture();
  assert.equal(attemptRecordHash(record), attemptRecordHash(Object.fromEntries(Object.entries(record).reverse())));
  assert.equal(commitAttemptRecord(record, salt), quote.recordCommitment);
  assert.notEqual(commitAttemptRecord(record, newAttemptId()), quote.recordCommitment);
  for (const key of Object.keys(record).filter(k => k !== "schemaVersion")) {
    const changed = { ...record };
    if (["inputDigest", "sourceVersion"].includes(key)) changed[key] = newAttemptId();
    else if (typeof changed[key] === "number") changed[key] = key === "maxSources" ? 4 : 1;
    else if (["executeBy", "principal", "executionCap", "evaluationCap"].includes(key)) changed[key] = String(BigInt(changed[key]) + 1n);
    else changed[key] += "/changed";
    assert.notEqual(attemptRecordHash(changed), attemptRecordHash(record), key);
  }
  assert.equal(bindRecordToQuote(record, salt, quote), true);
  assert.throws(() => bindRecordToQuote(record, salt, { ...quote, principal: "101" }));
  assert.notEqual(commitEvidenceDigest(record.inputDigest, salt), quote.recordCommitment);
});

test("AES-GCM round trip requires the correct key, binding, IV, ciphertext and tag", () => {
  const { record } = attemptFixture(); const key = randomBytes(32);
  const envelope = sealAttemptRecord(record, key);
  assert.deepEqual(openAttemptRecord(envelope, key, envelope.commitment), record);
  assert.notEqual(sealAttemptRecord(record, key).commitment, envelope.commitment);
  assert.ok(!JSON.stringify(envelope).includes(record.taskRef));
  assert.throws(() => openAttemptRecord(envelope, randomBytes(32), envelope.commitment));
  assert.throws(() => openAttemptRecord(envelope, key, newAttemptId()));
  for (const name of ["iv", "ciphertext", "tag"]) {
    const changed = { ...envelope, [name]: (envelope[name][0] === "0" ? "1" : "0") + envelope[name].slice(1) };
    assert.throws(() => openAttemptRecord(changed, key, envelope.commitment));
  }
  assert.throws(() => sealAttemptRecord(record, randomBytes(31)));
  const escaped = { ...record };
  for (const name of ["offerRef", "outcomeSpecRef", "contextRef", "taskRef", "principalRef", "accessSnapshotRef", "termsRef"]) escaped[name] = "\\".repeat(1024);
  const largest = sealAttemptRecord(escaped, key);
  assert.deepEqual(openAttemptRecord(largest, key, largest.commitment), escaped);
});

test("Canonical amounts, strict fields and schema guards reject ambiguous signing inputs", () => {
  const { record, quote, receipt } = attemptFixture();
  for (const value of [1, -1, "-1", "01", "1.0", "1e3", (1n << 256n).toString()]) assert.throws(() => atomic(value));
  assert.equal(atomic(((1n << 256n) - 1n).toString()), ((1n << 256n) - 1n).toString());
  assert.throws(() => normalizeAttemptRecord({ ...record, extra: true }));
  assert.throws(() => normalizeAttemptRecord({ ...record, taskRef: "\ud800" }));
  assert.throws(() => normalizeAttemptRecord({ ...record, taskRef: "\u0000" }));
  assert.throws(() => normalizeAttemptRecord({ ...record, maxSources: 6 }));
  assert.throws(() => normalizeQuote({ ...quote, policyHash: newAttemptId() }));
  assert.throws(() => normalizeQuote({ ...quote, timeoutMode: 2 }));
  assert.throws(() => normalizeQuote({ ...quote, settleBy: quote.executeBy }));
  assert.throws(() => normalizeQuote({ ...quote, principal: ((1n << 256n) - 1n).toString() }));
  assert.throws(() => normalizeReceipt({ ...receipt, evaluatedAt: "1000" }));
});

test("Issuer approval, all quote fields, chain and contract are signature bound", async () => {
  const { issuer, evaluator, domain, quote } = attemptFixture();
  const signature = await issuer.signTypedData(quoteTypedData(domain, quote));
  const input = { domain, quote, signature, approvedIssuer: issuer.address, now: "1000" };
  assert.equal(await verifyQuote(input), true);
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (order - BigInt(`0x${signature.slice(66, 130)}`)).toString(16).padStart(64, "0");
  const malleated = signature.slice(0, 66) + highS + (signature.slice(130) === "1b" ? "1c" : "1b");
  assert.equal(await verifyQuote({ ...input, signature: malleated }), false);
  assert.equal(await verifyQuote({ ...input, now: "1051" }), false);
  assert.equal(await verifyQuote({ ...input, approvedIssuer: evaluator.address }), false);
  for (const change of [{ principal: "101" }, { recordCommitment: newAttemptId() }, { attemptId: newAttemptId() }, { evaluatorSigner: issuer.address }]) {
    assert.equal(await verifyQuote({ ...input, quote: { ...quote, ...change } }), false);
  }
  assert.equal(await verifyQuote({ ...input, domain: { ...domain, chainId: "31338" } }), false);
  assert.equal(await verifyQuote({ ...input, domain: { ...domain, verifyingContract: quote.connectorPayee } }), false);
});

test("Evaluator receipts bind attempt, quote, authority, consumption and lifecycle bounds", async () => {
  const { issuer, evaluator, domain, quote, receipt } = attemptFixture();
  const signature = await evaluator.signTypedData(receiptTypedData(domain, receipt));
  const input = { domain, quote, receipt, signature, fundedAt: "1000", now: "1080" };
  assert.equal(await verifyReceipt(input), true);
  for (const change of [{ attemptId: newAttemptId() }, { quoteDigest: newAttemptId() }, { evidenceCommitment: newAttemptId() },
    { outcome: 2 }, { executionUsed: "21" }, { evaluationUsed: "11" }, { completedAt: "999" },
    { completedAt: "1101", evaluatedAt: "1102" }]) assert.equal(await verifyReceipt({ ...input, receipt: { ...receipt, ...change } }), false);
  assert.equal(await verifyReceipt({ ...input, signature: await issuer.signTypedData(receiptTypedData(domain, receipt)) }), false);
  assert.equal(await verifyReceipt({ ...input, now: "1079" }), false);
  assert.equal(await verifyReceipt({ ...input, now: "1201" }), false);
});

test("Exact allocation conserves funds for success, eligible failure and full timeout refund", () => {
  const { domain, quote, receipt } = attemptFixture();
  assert.deepEqual(allocateReceipt({ domain, quote, receipt }), { connector: "100", executor: "7", evaluator: "3", buyerCredit: "20", totalFunded: "130" });
  assert.deepEqual(allocateReceipt({ domain, quote, receipt: { ...receipt, outcome: 2 } }), { connector: "0", executor: "7", evaluator: "3", buyerCredit: "120", totalFunded: "130" });
  assert.deepEqual(allocateTimeout(quote, "1201"), { connector: "0", executor: "0", evaluator: "0", buyerCredit: "130", totalFunded: "130" });
  assert.throws(() => allocateTimeout(quote, "1200"));
  assert.throws(() => allocateReceipt({ domain, quote, receipt: { ...receipt, outcome: 3 } }));
  assert.throws(() => allocateReceipt({ domain, quote, receipt: { ...receipt, quoteDigest: newAttemptId() } }));
});
