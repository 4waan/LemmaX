import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAudit } from "../src/local-audit.mjs";
import { RULEBOOK } from "../src/rulebook.mjs";
import { admission } from "../src/rulebook.mjs";
import { RULEBOOK_INDEX } from "../src/rulebook.mjs";

const roles = RULEBOOK.roles, [main, b] = roles.evaluators;
const id = n => `0x${n.toString(16).padStart(64, "0")}`;
const quote = (n, e) => ({ attemptId: id(n), recordCommitment: id(100 + n), policyHash: id(200), issuer: roles.issuer.address, buyer: "0x2B62DaD005E9342A11C651C236bbdE7AfBa64681",
  connectorPayee: roles.connectors[0].address, executorPayee: roles.executor.address, evaluatorPayee: e.payee, evaluatorSigner: e.signer, asset: RULEBOOK.asset,
  principal: 5000n, executionCap: 2000n, evaluationCap: 1000n, quoteExpiresAt: 1120n, executeBy: 1240n, settleBy: 1600n, timeoutMode: 1 });
let index = 0;
const log = (eventName, args) => ({ eventName, args, blockNumber: 10n, blockHash: id(900), transactionHash: id(800 + ++index), logIndex: index });
const events = [log("AttemptTerms", { attemptId: id(1), buyer: quote(1, main).buyer, evaluatorSigner: main.signer, quote: quote(1, main) }),
  log("AttemptOutcome", { attemptId: id(1), state: 2, evidenceCommitment: id(5), executionUsed: 1500n, evaluationUsed: 800n }),
  log("AttemptTerms", { attemptId: id(2), buyer: quote(2, b).buyer, evaluatorSigner: b.signer, quote: quote(2, b) }),
  log("AttemptOutcome", { attemptId: id(2), state: 2, evidenceCommitment: id(6), executionUsed: 1500n, evaluationUsed: 1000n })];
const publicClient = { getBlockNumber: async () => 20n, getContractEvents: async ({ fromBlock }) => (fromBlock <= 10n ? events : []) };

test("The local auditor applies the shared rules to chain logs, so the guard works without a hosted index", async () => {
  const audit = createLocalAudit({ publicClient, address: "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7", fromBlock: 1n });
  const { records, freshness } = await audit.partyRecords([main.signer, b.signer, roles.issuer.address]);
  assert.equal(freshness.lagBlocks, 0);
  assert.deepEqual([records[b.signer.toLowerCase()].blocking, records[b.signer.toLowerCase()].lastVerdict], [1, "above_tariff"]);
  assert.deepEqual([records[main.signer.toLowerCase()].blocking, records[main.signer.toLowerCase()].attempts, records[roles.issuer.address.toLowerCase()].attempts], [0, 1, 2]);
  const next = { ...quote(3, b), principal: "5000", executionCap: "2000", evaluationCap: "1000", quoteExpiresAt: "1120", executeBy: "1240", settleBy: "1600" };
  assert.deepEqual(admission({ quote: next, index: RULEBOOK_INDEX, records, indexLagBlocks: 0 }).reasons, ["evaluator_flagged"]);
  const one = await audit.attempt(id(2));
  assert.deepEqual([one.attempt.state, one.verdicts.map(v => v.code)], ["settled_success", ["above_tariff"]]);
});
