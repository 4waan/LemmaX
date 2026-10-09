import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { RETRIEVAL_OFFERS, digest } from "../src/retrieval.mjs";
import { SCIFACT_PROFILE, loadSciFact, createSciFactIndex, representativeCases } from "../src/scifact.mjs";

export function implementationHashes() {
  return Object.fromEntries(["src/retrieval.mjs", "src/scifact.mjs", "scripts/benchmark-retrieval.mjs"].map(path => [path, digest(readFileSync(new URL(`../${path}`, import.meta.url)))]));
}

export function benchmark(directory) {
  const started = performance.now();
  const data = loadSciFact(directory);
  const groups = representativeCases(data);
  const representatives = new Set(groups.map(g => g.representative));
  const before = process.memoryUsage().heapUsed;
  const buildStarted = performance.now();
  const index = createSciFactIndex(data);
  const buildMs = performance.now() - buildStarted;
  const indexHeapDeltaBytes = process.memoryUsage().heapUsed - before;
  const queryIds = [...data.gold.keys()].sort();
  const rows = [];
  const latencies = new Map(RETRIEVAL_OFFERS.map(o => [o.offerRef, []]));
  const cpu = new Map(RETRIEVAL_OFFERS.map(o => [o.offerRef, 0]));
  for (const [caseIndex, caseRef] of queryIds.entries()) {
    const outputs = {};
    // Alternate order to reduce systematic warm-up/order advantage.
    for (const offer of caseIndex % 2 ? [...RETRIEVAL_OFFERS].reverse() : RETRIEVAL_OFFERS) {
      const t = performance.now();
      const c = process.cpuUsage();
      const sources = index.search({ offerRef: offer.offerRef, query: data.queries.get(caseRef),
        requestingPrincipal: SCIFACT_PROFILE.principalRef, requiredSourceVersion: SCIFACT_PROFILE.corpusSha256,
        excludeSourceRef: caseRef });
      const consumed = process.cpuUsage(c);
      cpu.set(offer.offerRef, cpu.get(offer.offerRef) + consumed.user + consumed.system);
      latencies.get(offer.offerRef).push(performance.now() - t);
      const ranking = sources.map(s => s.sourceRef);
      outputs[offer.offerRef] = { ranking, scores: sources.map(s => s.score),
        success: ranking.some(id => data.gold.get(caseRef).has(id)) };
    }
    rows.push({ caseRef, relevantSourceRefs: [...data.gold.get(caseRef)].sort(),
      representative: representatives.has(caseRef), outputs });
  }
  const offers = RETRIEVAL_OFFERS.map(offer => {
    const successes = rows.filter(row => row.outputs[offer.offerRef].success).length;
    const representativeSuccesses = rows.filter(row => row.representative && row.outputs[offer.offerRef].success).length;
    const times = latencies.get(offer.offerRef);
    return { ...offer, cases: rows.length, successes, failures: rows.length - successes,
      observedHitRate: successes / rows.length, representativeCases: groups.length, representativeSuccesses,
      representativeFailures: groups.length - representativeSuccesses,
      localMeanQueryMs: times.reduce((a, b) => a + b, 0) / times.length,
      localP95QueryMs: [...times].sort((a, b) => a - b)[Math.ceil(0.95 * times.length) - 1],
      measuredCpuMicroseconds: cpu.get(offer.offerRef), paidApiCalls: 0, trainingRuns: 0 };
  });
  const paired = { bothSuccess: 0, onlyFirstSuccess: 0, onlySecondSuccess: 0, bothFailure: 0 };
  for (const row of rows) {
    const a = row.outputs[offers[0].offerRef].success;
    const b = row.outputs[offers[1].offerRef].success;
    paired[a ? b ? "bothSuccess" : "onlyFirstSuccess" : b ? "onlySecondSuccess" : "bothFailure"]++;
  }
  return {
    schemaVersion: "retrieval-benchmark/v1", profile: SCIFACT_PROFILE,
    codeSha256: implementationHashes(), observedAt: Math.floor(Date.now() / 1000),
    corpusDocuments: index.documentCount, queryCases: rows.length,
    sourceOutputLimit: 5, sameIdExclusion: true,
    selection: { rule: "one-lexicographically-first-query-per-shared-gold-or-duplicate-query-component/v1", groups,
      independence: "not_established", timing: "Selected before evaluating either offer" },
    offers, paired,
    run: { nodeVersion: process.version, platform: process.platform, arch: process.arch,
      indexBuildMs: buildMs, indexHeapDeltaBytes, totalMs: performance.now() - started,
      latencyScope: "Single local process, synchronous scoring and sorting. No network, concurrency or API SLA.",
      monetaryCost: null, monetaryCostReason: "Local CPU and memory are measured; no hosting tariff is selected." },
    interpretation: "Public source relevance only. Not enterprise acceptance, confidentiality certification, answer accuracy or calibrated customer success probability.",
    perCase: rows,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.LEMMAX_BENCHMARK_OUTPUT;
  if (!output) throw new TypeError("Set LEMMAX_BENCHMARK_OUTPUT to a directory outside git");
  const result = benchmark(process.env.LEMMAX_SCIFACT_DIR);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "retrieval-paired-results.json"), JSON.stringify(result, null, 2) + "\n");
  const { perCase, selection, ...summary } = result;
  console.log(JSON.stringify({ ...summary, representativeCases: selection.groups.length }, null, 2));
}
