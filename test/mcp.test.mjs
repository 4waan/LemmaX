import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.mjs";
import { createPublicDirectory, ILLUSTRATIVE_SCENARIO } from "../src/directory.mjs";
import { SCIFACT_PROFILE } from "../src/scifact.mjs";
import { RETRIEVAL_OFFERS, createRetrievalIndex } from "../src/retrieval.mjs";
import { loadRetrievalReport, verifyRetrievalReport } from "../scripts/verify-retrieval.mjs";

const report = loadRetrievalReport();
const index = createRetrievalIndex({ documents: [{ id: "fixture", title: "", text: "cancer therapy",
  location: "urn:fixture:fixture", sourceVersion: SCIFACT_PROFILE.corpusSha256,
  authorizedPrincipals: [SCIFACT_PROFILE.principalRef] }],
  principalRef: SCIFACT_PROFILE.principalRef, sourceVersion: SCIFACT_PROFILE.corpusSha256 });
const directory = createPublicDirectory({ report, index,
  data: { documents: [{ id: "fixture", title: "", text: "cancer therapy", location: "urn:fixture:fixture",
    sourceVersion: SCIFACT_PROFILE.corpusSha256, authorizedPrincipals: [SCIFACT_PROFILE.principalRef] }],
    queries: new Map([["known", "cancer"]]), gold: new Map([["known", new Set(["fixture"])]]) },
  asOf: () => report.observedAt });

async function connect(t) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(directory);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}

test("MCP discovers offers and keeps unknown probability and pricing unranked", async t => {
  const client = await connect(t);
  assert.equal((await client.listTools()).tools.length, 5);
  const list = (await client.callTool({ name: "lemma_list_offers", arguments: {} })).structuredContent;
  assert.equal(list.offers.length, 2); assert.equal(list.fundable, false);
  const result = (await client.callTool({ name: "lemma_assess", arguments: { profileRef: SCIFACT_PROFILE.profileRef } })).structuredContent;
  for (const offer of result.results) {
    assert.equal(offer.pOutcome.mean, null); assert.equal(offer.cReuse, null); assert.equal(offer.rank, null);
    assert.equal(offer.contribution, undefined);
    assert.ok(offer.observedHitRate > 0);
  }
});

test("Explicit illustrative scenario uses measured counts and synthetic workload billing", async t => {
  const client = await connect(t);
  const result = (await client.callTool({ name: "lemma_assess", arguments: {
    profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: ILLUSTRATIVE_SCENARIO } })).structuredContent;
  assert.equal(result.fundable, false);
  assert.equal(result.independenceStatus, "not_established");
  assert.equal(result.assumptions.length, 2);
  assert.equal(result.results[0].pOutcome.evidence.successes, 184);
  assert.equal(result.results[1].pOutcome.evidence.successes, 189);
  assert.ok(result.results.every(o => o.pOutcome.mean > 0 && o.cReuse > 0 && o.currency === "DEMO_UNITS"));
  assert.deepEqual(result.results.map(o => o.rank), [2, 1]);
  assert.equal(result.results[1].billing.fixedFeeApplied, 0.3);
});

test("MCP search and replay return provenance without extending evidence", async t => {
  const client = await connect(t);
  const offerRef = RETRIEVAL_OFFERS[0].offerRef;
  const arbitrary = (await client.callTool({ name: "lemma_retrieve", arguments: { offerRef, query: "cancer" } })).structuredContent;
  assert.equal(arbitrary.sources[0].sourceRef, "fixture"); assert.equal(arbitrary.pOutcome, null);
  const source = (await client.callTool({ name: "lemma_read_source", arguments: { sourceRef: arbitrary.sources[0].sourceRef } })).structuredContent;
  assert.equal(source.excerpt, "cancer therapy");
  assert.equal(source.sourceVersion, arbitrary.sources[0].sourceVersion);
  assert.equal((await client.callTool({ name: "lemma_read_source", arguments: { sourceRef: "../private" } })).isError, true);
  const replay = (await client.callTool({ name: "lemma_run_benchmark_case", arguments: { offerRef, caseRef: "known" } })).structuredContent;
  assert.equal(replay.observedSuccess, true); assert.equal(replay.repeatCountsAsNewEvidence, false);
  const denied = await client.callTool({ name: "lemma_run_benchmark_case", arguments: { offerRef, caseRef: "../private" } });
  assert.equal(denied.isError, true); assert.ok(!denied.content[0].text.includes("private"));
});

test("MCP rejects invented trusted fields, cross-profile assessment and query abuse", async t => {
  const client = await connect(t);
  for (const request of [
    { name: "lemma_assess", arguments: { profileRef: SCIFACT_PROFILE.profileRef, successes: 9999 } },
    { name: "lemma_assess", arguments: { profileRef: "company-private" } },
    { name: "lemma_retrieve", arguments: { offerRef: RETRIEVAL_OFFERS[0].offerRef, query: "cancer", requestingPrincipal: "company-b" } },
    { name: "lemma_retrieve", arguments: { offerRef: RETRIEVAL_OFFERS[0].offerRef, query: "x".repeat(2049) } },
    { name: "lemma_list_offers", arguments: { corpusPath: "/private" } },
  ]) assert.equal((await client.callTool(request)).isError, true);
});

test("Stale benchmark evidence keeps conditional models and cost ranks unknown", () => {
  const stale = createPublicDirectory({ report, index, data: {}, asOf: () => report.observedAt + 2592001 });
  const result = stale.assess({ profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: ILLUSTRATIVE_SCENARIO });
  for (const offer of result.results) { assert.equal(offer.pOutcome.mean, null); assert.equal(offer.rank, null); }
});

test("Source reading enforces authorization and excerpt bounds across pages", () => {
  const docs = [{ id: "long", text: "x".repeat(2005), title: "t".repeat(600), location: "urn:long",
    sourceVersion: SCIFACT_PROFILE.corpusSha256, authorizedPrincipals: [SCIFACT_PROFILE.principalRef] },
  { id: "denied", text: "private", sourceVersion: SCIFACT_PROFILE.corpusSha256, authorizedPrincipals: [] }];
  const d = createPublicDirectory({ report, index, data: { documents: docs } });
  const first = d.readSource({ sourceRef: "long" });
  assert.equal(first.excerpt.length, 1000); assert.equal(first.title.length, 512); assert.equal(first.nextOffset, 1000);
  const last = d.readSource({ sourceRef: "long", offset: 2000 });
  assert.equal(last.excerpt.length, 5); assert.equal(last.nextOffset, null);
  for (const args of [{ sourceRef: "denied" }, { sourceRef: "unknown" }, { sourceRef: "long", offset: -1 }, { sourceRef: "long", offset: 2006 }]) assert.throws(() => d.readSource(args));
});

test("Report validation rejects tampered success totals and code binding", () => {
  const tampered = structuredClone(report); tampered.offers[0].successes++;
  assert.throws(() => verifyRetrievalReport(tampered));
  const changedCode = structuredClone(report); changedCode.codeSha256["src/retrieval.mjs"] = "changed";
  assert.throws(() => verifyRetrievalReport(changedCode));
});
