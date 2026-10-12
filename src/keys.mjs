import { hkdfSync } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const SALT = "LemmaX key derivation/v1";

// Demonstration keys that LemmaX would otherwise have to store are derived from a key the
// operator already holds, by HKDF with a fixed label. The same parent and label always give
// the same key, so nothing new is stored, and a label names each key's single purpose.
// A derived key is exactly as protected as its parent; never derive across trust boundaries.
export function deriveKeyBytes(parentHex, label, order) {
  if (typeof parentHex !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(parentHex)) throw new TypeError("Parent key must be 32 bytes of hex");
  if (typeof label !== "string" || !/^lemmax\/[a-z0-9/._-]{1,96}$/.test(label)) throw new TypeError("Label must start with lemmax/");
  for (let counter = 0; counter < 16; counter++) {
    const bytes = Buffer.from(hkdfSync("sha256", Buffer.from(parentHex.slice(2), "hex"), SALT, `${label}#${counter}`, 32));
    const value = BigInt(`0x${bytes.toString("hex")}`);
    if (value > 0n && value < order) return `0x${bytes.toString("hex")}`;
  }
  throw new Error("Key derivation did not produce a valid scalar");
}
export const deriveSecp256k1Key = (parentHex, label) => deriveKeyBytes(parentHex, label, SECP256K1_ORDER);
export const deriveP256Key = (parentHex, label) => deriveKeyBytes(parentHex, label, P256_ORDER);

// Labelled demonstration evaluator used for fault injection, derived from the evaluator key.
export const EVALUATOR_B_LABEL = "lemmax/evaluator-b/v1";
export function evaluatorBAccount(env) {
  try { return privateKeyToAccount(deriveSecp256k1Key(env.EVALUATOR_PRIVATE_KEY, EVALUATOR_B_LABEL)); }
  catch { throw new TypeError("EVALUATOR_PRIVATE_KEY is missing or is not a private key"); }
}
