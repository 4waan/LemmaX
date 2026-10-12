import RULEBOOK from "./lemmax-rulebook-v1.json" with { type: "json" };
import { rulebookIndex } from "./conformance.mjs";

// The rulebook this indexer audits against; its hash is cited by every verdict.
export const INDEX = rulebookIndex(RULEBOOK);
