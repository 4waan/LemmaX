import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAuditClient, verifyAttempt } from "../src/audit.mjs";
import { RULEBOOK_HASH } from "../src/rulebook.mjs";
import { createMcpServer } from "../src/mcp.mjs";

const ID = `0x${"01".repeat(32)}`;
// A stand-in for the auditor's GraphQL endpoint; it answers by the entities a query names.
function fakeAuditor({ progressBlock = 100, attempt = null, verdicts = [], parties = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { query, variables } = JSON.parse(init.body); calls.push({ url, query, variables });
    const data = { _meta: [{ chainId: 10143, progressBlock, isReady: true }] };
    if (query.includes("Attempt(")) Object.assign(data, { Attempt: attempt ? [attempt] : [], Verdict: verdicts });
    if (query.includes("PartyRecord(")) data.PartyRecord = parties;
    return { ok: true, json: async () => ({ data }) };
  };
  return { calls, fetchImpl };
}
const publicClient = { chain: { id: 10143 }, getBlockNumber: async () => 104n };

test("The audit client reports index lag against the caller's own chain head and filters records by rulebook", async () => {
  const auditor = fakeAuditor({ parties: [{ party: "0xabc", rulebookHash: RULEBOOK_HASH, blocking: 1, recorded: 0, informational: 0, attempts: 2 }] });
  const audit = createAuditClient({ url: "https://auditor.example/v1/graphql", publicClient, fetchImpl: auditor.fetchImpl });
  assert.deepEqual(await audit.freshness(), { progressBlock: "100", head: "104", lagBlocks: 4 });
  const { records, freshness } = await audit.partyRecords(["0xABC", "0xabc"]);
  assert.deepEqual([records["0xabc"].blocking, freshness.lagBlocks], [1, 4]);
  assert.deepEqual(auditor.calls[1].variables, { parties: ["0xabc"], hash: RULEBOOK_HASH });
  assert.throws(() => createAuditClient({ url: "not a url", publicClient }), /GraphQL URL/);
});

test("lemma_verify_attempt answers in one plain summary and exists only with an auditor", async t => {
  const attempt = { id: ID, state: "settled_success", termsSource: "event", fundTx: `0x${"aa".repeat(32)}`, outcomeTx: `0x${"bb".repeat(32)}`,
    allocation: { connector: "5000", executor: "1500", evaluator: "1000", buyer: "500", total: "8000" }, verdictCodes: ["above_tariff"], blocking: true };
  const verdicts = [{ code: "above_tariff", severity: "blocking", party: "0xf706", role: "evaluator", detail: "charged 1500/1000 against tariff 1500/800", rulebookHash: RULEBOOK_HASH, txHash: attempt.outcomeTx }];
  const audit = createAuditClient({ url: "https://auditor.example/v1/graphql", publicClient, fetchImpl: fakeAuditor({ attempt, verdicts }).fetchImpl });
  const direct = await verifyAttempt(audit, ID);
  assert.equal(direct.summary, "settled success; allocation rebuilt from public terms; 1 rule finding(s): above_tariff");
  const directory = { listOffers: () => ({}), assess: () => ({}), retrieve: () => ({}), readSource: () => ({}), runBenchmarkCase: () => ({}) };
  const names = async options => {
    const server = createMcpServer(directory, null, options), client = new Client({ name: "agent", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
    t.after(async () => { await client.close(); await server.close(); });
    return { client, tools: (await client.listTools()).tools.map(x => x.name) };
  };
  assert.equal((await names()).tools.includes("lemma_verify_attempt"), false);
  const { client, tools } = await names({ audit });
  assert.equal(tools.includes("lemma_verify_attempt"), true);
  const result = await client.callTool({ name: "lemma_verify_attempt", arguments: { attemptId: ID } });
  assert.deepEqual([result.structuredContent.found, result.structuredContent.indexLagBlocks, result.structuredContent.verdicts.length], [true, 4, 1]);
});
