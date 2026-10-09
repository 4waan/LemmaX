import test from "node:test";
import assert from "node:assert/strict";
import { metrics } from "../scripts/verify-scifact.mjs";

test("Relevance metrics distinguish rank boundaries and incomplete retrieval", () => {
  const first = metrics(["gold"], ["gold"]);
  assert.deepEqual(first, { hit_at_5: 1, recall_at_5: 1, recall_at_10: 1, ndcg_at_10: 1, mrr_at_10: 1 });
  for (const rank of [5, 6, 10, 11]) {
    const list = Array.from({ length: rank }, (_, i) => `wrong-${i}`); list[rank - 1] = "gold";
    const result = metrics(list, ["gold"]);
    assert.equal(result.hit_at_5, rank <= 5 ? 1 : 0);
    assert.equal(result.recall_at_10, rank <= 10 ? 1 : 0);
    assert.equal(result.mrr_at_10, rank <= 10 ? 1 / rank : 0);
  }
  assert.equal(metrics(["gold-a"], ["gold-a", "gold-b"]).recall_at_5, 0.5);
  assert.equal(metrics([], ["gold"]).ndcg_at_10, 0);
  assert.throws(() => metrics(["gold", "gold"], ["gold"]));
  assert.throws(() => metrics([], []));
});
