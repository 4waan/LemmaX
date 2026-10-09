import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { digest } from "../src/retrieval.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SCIFACT_PROFILE } from "../src/scifact.mjs";
import { loadRetrievalReport } from "./verify-retrieval.mjs";

const report = loadRetrievalReport();
const client = new Client({ name: "LemmaX-integration-check", version: "0.2.0" });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL("./mcp-server.mjs", import.meta.url))],
  env: { LEMMAX_SCIFACT_DIR: process.env.LEMMAX_SCIFACT_DIR }, stderr: "pipe" });
let stderr = "";
transport.stderr?.on("data", data => { stderr += data; });
try {
  await client.connect(transport);
  const list = await client.listTools(); assert.equal(list.tools.length, 5);
  const evidence = await client.callTool({ name: "lemma_assess", arguments: { profileRef: SCIFACT_PROFILE.profileRef } });
  assert.ok(evidence.structuredContent.results.every(r => r.pOutcome.mean === null && r.rank === null));
  const scenario = await client.callTool({ name: "lemma_assess", arguments: {
    profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: "illustrative-workload-cost/v1" } });
  assert.ok(scenario.structuredContent.results.every(r => r.rank !== null));
  const latencies = [];
  const modes = [];
  let checked = 0;
  const requests = report.perCase.slice(0, 50).flatMap(row => report.offers.map(offer => ({ row, offer })));
  for (const window of [1, 4]) {
    const batchStarted = performance.now();
    const modeLatencies = [];
    for (let offset = 0; offset < requests.length; offset += window) {
      await Promise.all(requests.slice(offset, offset + window).map(async ({ row, offer }) => {
      const started = performance.now();
      const response = await client.callTool({ name: "lemma_run_benchmark_case", arguments: { offerRef: offer.offerRef, caseRef: row.caseRef } });
      const elapsed = performance.now() - started;
      latencies.push(elapsed); modeLatencies.push(elapsed);
      assert.equal(response.isError, undefined);
      assert.deepEqual(response.structuredContent.sources.map(s => s.sourceRef), row.outputs[offer.offerRef].ranking);
      assert.equal(response.structuredContent.observedSuccess, row.outputs[offer.offerRef].success);
      checked++;
      }));
    }
    const elapsedMs = performance.now() - batchStarted;
    modes.push({ inFlightWindow: window, requests: requests.length, elapsedMs,
      achievedLocalRequestsPerSecond: requests.length * 1000 / elapsedMs,
      meanRoundTripMs: modeLatencies.reduce((a, b) => a + b, 0) / modeLatencies.length,
      p95RoundTripMs: [...modeLatencies].sort((a, b) => a - b)[Math.ceil(0.95 * modeLatencies.length) - 1] });
  }
  const malformed = await client.callTool({ name: "lemma_assess", arguments: { profileRef: SCIFACT_PROFILE.profileRef, successes: 999 } });
  assert.equal(malformed.isError, true);
  const firstSource = report.perCase[0].outputs[report.offers[0].offerRef].ranking[0];
  const source = await client.callTool({ name: "lemma_read_source", arguments: { sourceRef: firstSource } });
  assert.ok(source.structuredContent.excerpt.length > 0 && source.structuredContent.excerpt.length <= 1000);
  assert.equal(source.structuredContent.sourceVersion, SCIFACT_PROFILE.corpusSha256);
  assert.equal(stderr, "");
  console.log(JSON.stringify({ schemaVersion: "mcp-smoke/v1", transport: "stdio", benchmarkReplaysChecked: checked,
    codeSha256: Object.fromEntries(["src/mcp.mjs", "src/directory.mjs", "scripts/mcp-server.mjs", "scripts/smoke-mcp.mjs"].map(path =>
      [path, digest(readFileSync(new URL(`../${path}`, import.meta.url)))])),
    toolCount: list.tools.length, observedAt: Math.floor(Date.now() / 1000),
    modes, meanRoundTripMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p95RoundTripMs: [...latencies].sort((a, b) => a - b)[Math.ceil(0.95 * latencies.length) - 1],
    limitation: "One local SDK client with in-flight windows of one and four. Synchronous server scoring, no worker parallelism. Not an independent partner integration, sustained production load or network SLA." }, null, 2));
} finally { await client.close(); }
