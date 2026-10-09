import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function metrics(ranking, gold) {
  const relevant = new Set(gold);
  if (!relevant.size) throw new Error("A scored query needs relevance labels");
  assert.equal(new Set(ranking).size, ranking.length, "Duplicate ranked document");
  const positions = [...relevant].map((id) => ranking.indexOf(id) + 1).filter((rank) => rank > 0);
  const discount = (rank) => 1 / Math.log2(rank + 1);
  const ideal = Array.from({ length: Math.min(relevant.size, 10) }, (_, i) => discount(i + 1)).reduce((a, b) => a + b, 0);
  return {
    hit_at_5: Number(positions.some((rank) => rank <= 5)),
    recall_at_5: positions.filter((rank) => rank <= 5).length / relevant.size,
    recall_at_10: positions.filter((rank) => rank <= 10).length / relevant.size,
    ndcg_at_10: positions.filter((rank) => rank <= 10).reduce((sum, rank) => sum + discount(rank), 0) / ideal,
    mrr_at_10: positions.some((rank) => rank <= 10) ? 1 / Math.min(...positions.filter((rank) => rank <= 10)) : 0,
  };
}

export function verify() {
  const report = JSON.parse(readFileSync(new URL("../benchmarks/scifact-bm25-results.json", import.meta.url), "utf8"));
  const code = readFileSync(new URL("../benchmarks/scifact_bm25.py", import.meta.url));
  assert.equal(createHash("sha256").update(code).digest("hex"), report.code_sha256, "Runner differs from measured version");
  assert.equal(report.per_query.length, report.scored_test_queries);
  assert.equal(new Set(report.per_query.map((q) => q.query_id)).size, report.scored_test_queries);
  const totals = Object.fromEntries(Object.keys(report.mean_query_metrics).map((key) => [key, 0]));
  let hits = 0;
  let pairs = 0;
  let checked = 0;
  let maximumError = 0;
  for (const query of report.per_query) {
    const found = metrics(query.ranking, query.relevant_document_ids);
    pairs += new Set(query.relevant_document_ids).size;
    hits += found.hit_at_5;
    for (const key of Object.keys(totals)) {
      const error = Math.abs(found[key] - query.metrics[key]);
      assert.ok(error <= 1e-12, `${query.query_id}/${key}`);
      maximumError = Math.max(maximumError, error);
      totals[key] += found[key];
      checked++;
    }
  }
  assert.equal(hits, report.queries_with_relevant_result_at_5);
  assert.equal(pairs, report.qrel_pairs);
  for (const key of Object.keys(totals)) {
    const error = Math.abs(totals[key] / report.per_query.length - report.mean_query_metrics[key]);
    assert.ok(error <= 1e-12, key);
    maximumError = Math.max(maximumError, error);
  }
  return { queryMetricPairsChecked: checked, aggregatesChecked: Object.keys(totals).length,
    hitsAtFive: hits, queries: report.scored_test_queries, maximumAbsoluteDifference: maximumError,
    limitation: "Checks stored rank/relevance metric arithmetic and runner hash, not ranking correctness, dataset ground truth, or company representativeness." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verify(), null, 2));
