import { keccak256, stringToBytes } from "viem";
import { canonicalJson } from "./conformance.mjs";

// LemmaX's ERC-8004 feedback format. Each record summarizes a batch of settled public
// benchmark attempts and restates only what settlement already made public: attempt IDs,
// outcome states and transaction hashes. It never carries offer, case, company or resource
// tags. The file travels as a base64 data URI and feedbackHash is keccak256 of its bytes.
export const FEEDBACK_SCHEMA = "lemmax-feedback/v1";
export const FEEDBACK_TAGS = Object.freeze({ acceptance: "lemmax/acceptance/v1", conformance: "lemmax/conformance/v1" });
const PREFIX = "data:application/json;base64,";

export function encodeFeedbackFile(file) {
  if (file?.schemaVersion !== FEEDBACK_SCHEMA || !FEEDBACK_TAGS[file.kind]) throw new TypeError("Not a LemmaX feedback file");
  const text = canonicalJson(file);
  return { uri: `${PREFIX}${Buffer.from(text, "utf8").toString("base64")}`, hash: keccak256(stringToBytes(text)), text };
}
export function decodeFeedbackUri(uri) {
  if (typeof uri !== "string" || !uri.startsWith(PREFIX) || uri.length > 65536) return null;
  try {
    const text = Buffer.from(uri.slice(PREFIX.length), "base64").toString("utf8");
    const file = JSON.parse(text);
    return file?.schemaVersion === FEEDBACK_SCHEMA ? { file, hash: keccak256(stringToBytes(text)) } : null;
  } catch { return null; }
}

// A share with two decimals, as ERC-8004 value and valueDecimals: 2 of 3 is 6667 and 2.
export function shareValue(count, total) {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total) || total <= 0 || count < 0 || count > total) throw new RangeError("Invalid share");
  return { value: Math.round((count * 10000) / total), valueDecimals: 2 };
}

// Acceptance: of the settled attempts listed, how many the evaluator accepted. Timeouts are
// not relevance outcomes and are excluded; the meaning is descriptive, not a probability.
export function acceptanceOf(attempts) {
  const settled = attempts.filter(a => a.state === "settled_success" || a.state === "settled_failure");
  return { settled: settled.length, accepted: settled.filter(a => a.state === "settled_success").length };
}
// Conformance: of the settled attempts an evaluator attested, how many had no blocking verdict.
export function conformanceOf(attempts) {
  const settled = attempts.filter(a => a.state === "settled_success" || a.state === "settled_failure");
  return { settled: settled.length, conforming: settled.filter(a => !a.blocking).length };
}
