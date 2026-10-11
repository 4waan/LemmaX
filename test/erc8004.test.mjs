import test from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters } from "viem";
import { ERC8004, LEMMAX_AGENTS, dataUri, registrationFile, registrationMetadata } from "../src/erc8004.mjs";
import { RULEBOOK, RULEBOOK_HASH } from "../src/rulebook.mjs";

const settlement = "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7";
const rulebook = { ref: RULEBOOK.rulebookRef, hash: RULEBOOK_HASH };

test("Registration files follow registration-v1 and name the settlement, rulebook and disclosure policy", () => {
  assert.deepEqual(Object.keys(LEMMAX_AGENTS), ["directory", "evaluator", "evaluatorB", "provider"]);
  const file = registrationFile({ role: "directory", agentId: "2107", settlement, rulebook, auditor: "https://auditor.example/v1/graphql" });
  assert.equal(file.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.deepEqual(file.registrations, [{ agentId: 2107, agentRegistry: `eip155:10143:${ERC8004.identity}` }]);
  assert.deepEqual(file.services.map(s => s.name), ["MCP", "web"]);
  assert.deepEqual([file.lemmax.settlement, file.lemmax.rulebook.hash, file.lemmax.auditor], [settlement, RULEBOOK_HASH, "https://auditor.example/v1/graphql"]);
  assert.deepEqual(registrationFile({ role: "provider", settlement, rulebook }).services.map(s => s.name), ["web"]);
  assert.throws(() => registrationFile({ role: "nobody", settlement, rulebook }), /Unknown LemmaX agent role/);
  const uri = dataUri(file);
  assert.deepEqual(JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8")), file);
  // Descriptions carry no dates and no dashes the project avoids.
  for (const agent of Object.values(LEMMAX_AGENTS)) assert.doesNotMatch(agent.description, /[–—]|\b20\d\d\b/);
});

test("Onchain metadata encodes the role, the settlement contract with its chain, and the rulebook hash", () => {
  const [role, settled, hash] = registrationMetadata({ role: "evaluator", settlement, rulebook });
  assert.equal(Buffer.from(role.metadataValue.slice(2), "hex").toString("utf8"), "evaluator");
  assert.deepEqual(decodeAbiParameters([{ type: "uint256" }, { type: "address" }], settled.metadataValue), [10143n, settlement]);
  assert.deepEqual([hash.metadataKey, hash.metadataValue], ["lemmax.rulebook", RULEBOOK_HASH]);
});
