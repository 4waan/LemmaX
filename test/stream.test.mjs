import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FIXTURE_TOKEN } from "./fixtures/attempt.mjs";
import { watchCommitStages } from "../src/monad.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { createPurchaseDesk } from "../src/purchase.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { SCIFACT_PROFILE } from "../src/scifact.mjs";
import { RETRIEVAL_OFFERS, createRetrievalIndex } from "../src/retrieval.mjs";
import { loadRetrievalReport } from "../scripts/verify-retrieval.mjs";

const CONTRACT = "0x1000000000000000000000000000000000000001";
const TX = `0x${"ab".repeat(32)}`;

// A stand-in for a Monad WebSocket endpoint: acknowledges eth_subscribe, then the test
// pushes monadLogs messages through `emit`.
function fakeSocketClass(sockets) {
  return class {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); setTimeout(() => this.onopen?.(), 0); }
    send(text) {
      const message = JSON.parse(text); this.sent.push(message);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: "0xsub" }) }), 0);
    }
    emit(log) { this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", method: "eth_subscription", params: { subscription: "0xsub", result: log } }) }); }
    close() { this.closed = true; }
  };
}
const logAt = (commitState, blockId, transactionHash = TX) => ({ commitState, blockId, blockNumber: "0x10", transactionHash, address: CONTRACT, topics: [], data: "0x" });

test("monadLogs stages are buffered per transaction and only the block that reaches Verified is reported", async () => {
  const sockets = [];
  const watcher = await watchCommitStages({ wsUrl: "wss://example.invalid", address: CONTRACT, topics: ["0x01"], WebSocketImpl: fakeSocketClass(sockets) });
  const socket = sockets[0];
  assert.deepEqual(socket.sent[0].params, ["monadLogs", { address: CONTRACT, topics: ["0x01"] }]);
  // An abandoned proposal, a duplicate delivery and another transaction must not confuse the result.
  socket.emit(logAt("Proposed", "0xdead"));
  socket.emit(logAt("Proposed", "0xb1")); socket.emit(logAt("Proposed", "0xb1"));
  socket.emit(logAt("Proposed", "0xc1", `0x${"cd".repeat(32)}`));
  const seen = [];
  const done = watcher.until(TX.toUpperCase().replace("0X", "0x"), { onStage: s => seen.push(`${s.stage}:${s.blockId}`), timeoutMs: 1000 });
  socket.emit(logAt("Voted", "0xb1")); socket.emit(logAt("Finalized", "0xb1")); socket.emit(logAt("Verified", "0xb1"));
  const stages = await done;
  assert.deepEqual(stages.map(s => s.stage), ["Proposed", "Voted", "Finalized", "Verified"]);
  assert.deepEqual(seen, ["Proposed:0xdead", "Proposed:0xb1", "Voted:0xb1", "Finalized:0xb1", "Verified:0xb1"]);
  await assert.rejects(watcher.until(`0x${"ef".repeat(32)}`, { timeoutMs: 20 }), /Timed out waiting for Verified/);
  watcher.close();
  assert.equal(socket.closed, true);
  await assert.rejects(watchCommitStages({ wsUrl: "https://not-a-socket", address: CONTRACT }), /ws\(s\) URL/);
});

test("The fund tool reports each Monad commit state as MCP progress and returns at Verified", async t => {
  const a = Object.fromEntries(["issuer", "evaluator", "buyer", "connector"].map(name => [name, privateKeyToAccount(generatePrivateKey())]));
  const domain = { chainId: "10143", verifyingContract: CONTRACT };
  const token = { address: FIXTURE_TOKEN, name: "USDC", version: "2", chainId: 10143 };
  const issuer = createQuoteIssuer({ account: a.issuer, domain, token, caps: { maxPerAttempt: 8000n, dailyCap: 80000n },
    payees: { connector: a.connector.address, executor: a.issuer.address, evaluator: a.evaluator.address, evaluatorSigner: a.evaluator.address } });
  const documents = [{ id: "d1", title: "", text: "aspirin reduces fever", location: "urn:fixture:d1", sourceVersion: SCIFACT_PROFILE.corpusSha256, authorizedPrincipals: [SCIFACT_PROFILE.principalRef] }];
  const data = { documents, queries: new Map([["hit", "aspirin fever"]]), gold: new Map([["hit", new Set(["d1"])]]) };
  const index = createRetrievalIndex({ documents, principalRef: SCIFACT_PROFILE.principalRef, sourceVersion: SCIFACT_PROFILE.corpusSha256 });
  const settlement = {
    async fund() { return { hash: TX, blockNumber: 16n, blockHash: `0x${"cd".repeat(32)}`, gasUsed: 280000n, gasLimit: 308000n }; },
    async attemptInfo() { return { quoteDigest: `0x${"11".repeat(32)}`, fundedAt: "0", state: "none" }; },
  };
  const sockets = [];
  const stages = () => watchCommitStages({ wsUrl: "wss://example.invalid", address: CONTRACT, WebSocketImpl: fakeSocketClass(sockets) });
  let polled = 0;
  const desk = createPurchaseDesk({ issuer, settlement, relayer: {}, data, chainTime: async () => "1000", stages,
    confirm: async () => { polled++; return { stage: "verified" }; } });
  const report = loadRetrievalReport();
  const server = createMcpServer(createPublicDirectory({ report, index, data, asOf: () => report.observedAt }), desk);
  const client = new Client({ name: "buyer-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const q = (await client.callTool({ name: "lemma_quote_attempt", arguments: { offerRef: RETRIEVAL_OFFERS[1].offerRef, caseRef: "hit", profileRef: "demo-standard/v1", buyer: a.buyer.address } })).structuredContent;
  const signature = await a.buyer.signTypedData({ ...q.buyerAuthorization, domain: { ...q.buyerAuthorization.domain, chainId: 10143 } });
  const messages = [];
  const call = client.callTool({ name: "lemma_fund_attempt", arguments: { attemptId: q.attemptId, validAfter: q.buyerAuthorization.message.validAfter,
    validBefore: q.buyerAuthorization.message.validBefore, signature } }, undefined, { onprogress: p => messages.push(`${p.progress}/${p.total} ${p.message}`), resetTimeoutOnProgress: true });
  // Monad sends the stages as the block advances; emit them once the subscription exists.
  while (!sockets[0]?.sent.length) await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const stage of ["Proposed", "Voted", "Finalized", "Verified"]) sockets[0].emit(logAt(stage, "0xb1"));
  const result = (await call).structuredContent;
  assert.deepEqual(messages, ["1/5 Relayed", "2/5 Proposed", "3/5 Voted", "4/5 Finalized", "5/5 Verified"]);
  assert.deepEqual(result.timeline.map(x => x.step), ["Relayed", "Proposed", "Voted", "Finalized", "Verified"]);
  assert.deepEqual([result.state, result.confirmation, polled, sockets[0].closed], ["funded", "verified", 0, true]);
});
