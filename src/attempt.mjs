import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { encodeAbiParameters, getAddress, hashTypedData, keccak256, recoverTypedDataAddress, stringToHex, zeroAddress } from "viem";

export const ATTEMPT_SCHEMA = "private-attempt/v1";
export const OUTCOMES = Object.freeze({ success: 1, eligible_failure: 2, unresolved: 3 });
export const TIMEOUT_MODES = Object.freeze({ refund_all: 1 });
export const SETTLEMENT_POLICY_HASH = keccak256(stringToHex("LemmaX/principal-refund-and-timeout-refund/v1"));
const UINT256 = (1n << 256n) - 1n;
const UINT64 = (1n << 64n) - 1n;
const SECP_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const references = ["offerRef", "outcomeSpecRef", "contextRef", "taskRef", "principalRef", "accessSnapshotRef", "termsRef"];
const recordKeys = ["schemaVersion", ...references, "inputDigest", "sourceVersion", "maxSources", "retryLimit", "executeBy", "principal", "executionCap", "evaluationCap"];
const field = (name, type) => Object.freeze({ name, type });
const quoteFields = Object.freeze([
  field("attemptId", "bytes32"), field("recordCommitment", "bytes32"), field("policyHash", "bytes32"),
  ...["issuer", "buyer", "connectorPayee", "executorPayee", "evaluatorPayee", "evaluatorSigner", "asset"].map(name => field(name, "address")),
  ...["principal", "executionCap", "evaluationCap"].map(name => field(name, "uint256")),
  ...["quoteExpiresAt", "executeBy", "settleBy"].map(name => field(name, "uint64")),
  field("timeoutMode", "uint8"),
]);
const receiptFields = Object.freeze([
  field("attemptId", "bytes32"), field("quoteDigest", "bytes32"), field("evidenceCommitment", "bytes32"),
  field("outcome", "uint8"), field("executionUsed", "uint256"), field("evaluationUsed", "uint256"),
  field("completedAt", "uint64"), field("evaluatedAt", "uint64"),
]);
export const QUOTE_TYPES = Object.freeze({ AttemptQuote: quoteFields });
export const RECEIPT_TYPES = Object.freeze({ EvaluationReceipt: receiptFields });

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError("Unexpected or missing fields");
}
function ref(value) {
  if (typeof value !== "string" || !value.trim() || !value.isWellFormed() || /[\u0000-\u001f\u007f]/.test(value) || Buffer.byteLength(value, "utf8") > 1024) throw new TypeError("Invalid private reference");
  return value;
}
export function bytes32(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) throw new TypeError("Expected nonzero bytes32");
  return value.toLowerCase();
}
export function atomic(value, max = UINT256) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78 || BigInt(value) > max) throw new RangeError("Expected canonical unsigned integer string");
  return value;
}
function address(value, allowZero = false) {
  const normalized = getAddress(value);
  if (!allowZero && normalized === zeroAddress) throw new TypeError("Zero authority or payee");
  return normalized;
}
// Match the Solidity ECDSA boundary: 65 bytes, nonzero r, low s, v in 27/28.
function canonicalSignature(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{128}(1[bBcC])$/.test(value)) throw new TypeError("Invalid EVM signature encoding");
  const r = BigInt(`0x${value.slice(2, 66)}`), s = BigInt(`0x${value.slice(66, 130)}`);
  if (!r || r >= SECP_ORDER || !s || s > SECP_ORDER / 2n) throw new TypeError("Noncanonical EVM signature");
  return value;
}
export function hashReference(value) { return keccak256(stringToHex(ref(value))); }
export function newAttemptId() { return `0x${randomBytes(32).toString("hex")}`; }

export function normalizeAttemptRecord(input) {
  exactKeys(input, recordKeys);
  if (input.schemaVersion !== ATTEMPT_SCHEMA) throw new TypeError("Unsupported private record schema");
  const out = { schemaVersion: ATTEMPT_SCHEMA };
  for (const key of references) out[key] = ref(input[key]);
  for (const key of ["inputDigest", "sourceVersion"]) out[key] = bytes32(input[key]);
  if (!Number.isSafeInteger(input.maxSources) || input.maxSources < 1 || input.maxSources > 5) throw new RangeError("Invalid source limit");
  if (!Number.isSafeInteger(input.retryLimit) || input.retryLimit < 0 || input.retryLimit > 65535) throw new RangeError("Invalid retry limit");
  out.maxSources = input.maxSources; out.retryLimit = input.retryLimit;
  out.executeBy = atomic(input.executeBy, UINT64);
  for (const key of ["principal", "executionCap", "evaluationCap"]) out[key] = atomic(input[key]);
  return out;
}

// ABI encoding avoids dependence on JSON key order, floats or text serialization.
export function attemptRecordHash(record) {
  const r = normalizeAttemptRecord(record);
  return keccak256(encodeAbiParameters([
    ...Array.from({ length: 10 }, () => ({ type: "bytes32" })),
    { type: "uint8" }, { type: "uint16" }, { type: "uint64" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  ], [hashReference(r.schemaVersion), ...references.map(key => hashReference(r[key])), r.inputDigest, r.sourceVersion,
    r.maxSources, r.retryLimit, BigInt(r.executeBy), BigInt(r.principal), BigInt(r.executionCap), BigInt(r.evaluationCap)]));
}
export function commitAttemptRecord(record, salt) {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [hashReference("LemmaX/attempt-commitment/v1"), bytes32(salt), attemptRecordHash(record)]));
}
export function commitEvidenceDigest(evidenceDigest, salt) {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [hashReference("LemmaX/evidence-commitment/v1"), bytes32(salt), bytes32(evidenceDigest)]));
}

function encryptionKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError("Provide a 32-byte encryption key");
  return key;
}
export function sealAttemptRecord(record, key) {
  const r = normalizeAttemptRecord(record);
  const salt = newAttemptId();
  const commitment = commitAttemptRecord(r, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(`${ATTEMPT_SCHEMA}:${commitment}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ record: r, salt }), "utf8"), cipher.final()]);
  return { schemaVersion: "encrypted-attempt/v1", commitment,
    iv: iv.toString("hex"), ciphertext: ciphertext.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}
export function openAttemptRecord(envelope, key, expectedCommitment) {
  exactKeys(envelope, ["schemaVersion", "commitment", "iv", "ciphertext", "tag"]);
  if (envelope.schemaVersion !== "encrypted-attempt/v1" || bytes32(envelope.commitment) !== bytes32(expectedCommitment)) throw new TypeError("Unexpected encrypted record binding");
  for (const [name, size] of [["iv", 24], ["tag", 32]]) {
    if (typeof envelope[name] !== "string" || !new RegExp(`^[0-9a-f]{${size}}$`).test(envelope[name])) throw new TypeError("Invalid encryption metadata");
  }
  if (typeof envelope.ciphertext !== "string" || !/^(?:[0-9a-f]{2})+$/.test(envelope.ciphertext) || envelope.ciphertext.length > 32768) throw new RangeError("Invalid encrypted record size");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), Buffer.from(envelope.iv, "hex"));
  decipher.setAAD(Buffer.from(`${ATTEMPT_SCHEMA}:${envelope.commitment}`, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "hex")), decipher.final()]);
  const payload = JSON.parse(plaintext.toString("utf8"));
  exactKeys(payload, ["record", "salt"]);
  const record = normalizeAttemptRecord(payload.record);
  if (commitAttemptRecord(record, payload.salt) !== expectedCommitment.toLowerCase()) throw new TypeError("Private record commitment mismatch");
  return record;
}

export function signingDomain(input) {
  exactKeys(input, ["chainId", "verifyingContract"]);
  const chainId = BigInt(atomic(input.chainId));
  if (!chainId) throw new RangeError("Chain id must be positive");
  return { name: "LemmaXAttemptSettlement", version: "1", chainId,
    verifyingContract: address(input.verifyingContract) };
}
export function normalizeQuote(input) {
  exactKeys(input, quoteFields.map(f => f.name));
  const out = {};
  for (const f of quoteFields) {
    if (f.type === "bytes32") out[f.name] = bytes32(input[f.name]);
    else if (f.type === "address") out[f.name] = address(input[f.name], f.name === "asset");
    else if (f.type === "uint8") {
      if (!Object.values(TIMEOUT_MODES).includes(input[f.name])) throw new TypeError("Explicit timeout mode required");
      out[f.name] = input[f.name];
    } else out[f.name] = atomic(input[f.name], f.type === "uint64" ? UINT64 : UINT256);
  }
  if (!(BigInt(out.quoteExpiresAt) <= BigInt(out.executeBy) && BigInt(out.executeBy) < BigInt(out.settleBy))) throw new RangeError("Invalid quote deadline order");
  if (out.policyHash !== SETTLEMENT_POLICY_HASH) throw new TypeError("Unsupported settlement policy");
  if (BigInt(out.principal) + BigInt(out.executionCap) + BigInt(out.evaluationCap) > UINT256) throw new RangeError("Total funding overflow");
  return out;
}
export function quoteTypedData(domain, quote) {
  return { domain: signingDomain(domain), types: QUOTE_TYPES, primaryType: "AttemptQuote", message: normalizeQuote(quote) };
}
export function quoteDigest(domain, quote) { return hashTypedData(quoteTypedData(domain, quote)); }
export function bindRecordToQuote(record, salt, quote) {
  const r = normalizeAttemptRecord(record), q = normalizeQuote(quote);
  if (commitAttemptRecord(r, salt) !== q.recordCommitment) throw new TypeError("Record does not match quote commitment");
  for (const key of ["principal", "executionCap", "evaluationCap", "executeBy"]) if (r[key] !== q[key]) throw new TypeError("Record and public quote terms differ");
  return true;
}
export async function verifyQuote({ domain, quote, signature, approvedIssuer, now }) {
  const q = normalizeQuote(quote);
  if (address(approvedIssuer) !== q.issuer || BigInt(atomic(now, UINT64)) > BigInt(q.quoteExpiresAt)) return false;
  try { return address(await recoverTypedDataAddress({ ...quoteTypedData(domain, q), signature: canonicalSignature(signature) })) === q.issuer; }
  catch { return false; }
}

export function normalizeReceipt(input) {
  exactKeys(input, receiptFields.map(f => f.name));
  const out = {};
  for (const f of receiptFields) {
    if (f.type === "bytes32") out[f.name] = bytes32(input[f.name]);
    else if (f.type === "uint8") {
      if (!Object.values(OUTCOMES).includes(input[f.name])) throw new TypeError("Invalid evaluation outcome");
      out[f.name] = input[f.name];
    } else out[f.name] = atomic(input[f.name], f.type === "uint64" ? UINT64 : UINT256);
  }
  if (BigInt(out.completedAt) > BigInt(out.evaluatedAt)) throw new RangeError("Evaluation precedes completion");
  return out;
}
export function receiptTypedData(domain, receipt) {
  return { domain: signingDomain(domain), types: RECEIPT_TYPES, primaryType: "EvaluationReceipt", message: normalizeReceipt(receipt) };
}
export async function verifyReceipt({ domain, quote, receipt, signature, fundedAt, now }) {
  const q = normalizeQuote(quote), r = normalizeReceipt(receipt);
  const fundingTime = BigInt(atomic(fundedAt, UINT64)), current = BigInt(atomic(now, UINT64));
  if (r.attemptId !== q.attemptId || r.quoteDigest !== quoteDigest(domain, q)
    || fundingTime > BigInt(q.quoteExpiresAt) || BigInt(r.completedAt) < fundingTime
    || BigInt(r.completedAt) > BigInt(q.executeBy) || BigInt(r.evaluatedAt) > BigInt(q.settleBy)
    || BigInt(r.evaluatedAt) > current || current > BigInt(q.settleBy)
    || BigInt(r.executionUsed) > BigInt(q.executionCap) || BigInt(r.evaluationUsed) > BigInt(q.evaluationCap)) return false;
  try { return address(await recoverTypedDataAddress({ ...receiptTypedData(domain, r), signature: canonicalSignature(signature) })) === q.evaluatorSigner; }
  catch { return false; }
}

// Pure proposed settlement allocation. Call only after quote and receipt authority
// checks; this function has no ledger, replay protection, transfers or funding.
export function allocateReceipt({ domain, quote, receipt }) {
  const q = normalizeQuote(quote), r = normalizeReceipt(receipt);
  if (q.attemptId !== r.attemptId || r.quoteDigest !== quoteDigest(domain, q) || r.outcome === OUTCOMES.unresolved) throw new TypeError("Receipt cannot settle this attempt");
  const principal = BigInt(q.principal), execution = BigInt(r.executionUsed), evaluation = BigInt(r.evaluationUsed);
  if (execution > BigInt(q.executionCap) || evaluation > BigInt(q.evaluationCap)) throw new RangeError("Consumed charge exceeds reserve");
  const connector = r.outcome === OUTCOMES.success ? principal : 0n;
  const funded = principal + BigInt(q.executionCap) + BigInt(q.evaluationCap);
  return { connector: connector.toString(), executor: execution.toString(), evaluator: evaluation.toString(),
    buyerCredit: (funded - connector - execution - evaluation).toString(), totalFunded: funded.toString() };
}

export function allocateTimeout(quote, now) {
  const q = normalizeQuote(quote);
  if (BigInt(atomic(now, UINT64)) <= BigInt(q.settleBy)) throw new RangeError("Settlement deadline has not expired");
  const total = BigInt(q.principal) + BigInt(q.executionCap) + BigInt(q.evaluationCap);
  return { connector: "0", executor: "0", evaluator: "0", buyerCredit: total.toString(), totalFunded: total.toString() };
}
