import { readFileSync } from "node:fs";
import { rulebookHash, rulebookIndex } from "../indexer/src/shared/conformance.mjs";

// The published rulebook lives at rulebook/; the indexer carries a byte-identical copy
// because Envio builds only its own directory. Both use the same pure conformance rules.
export { admission, canonicalJson, outcomeVerdicts, publicAllocation, quoteVerdicts, rulebookHash, rulebookIndex } from "../indexer/src/shared/conformance.mjs";
export const RULEBOOK = Object.freeze(JSON.parse(readFileSync(new URL("../rulebook/lemmax-rulebook-v1.json", import.meta.url), "utf8")));
export const RULEBOOK_HASH = rulebookHash(RULEBOOK);
export const RULEBOOK_INDEX = rulebookIndex(RULEBOOK);
