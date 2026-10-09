import test from "node:test";
import assert from "node:assert/strict";
import { createRetrievalIndex, RETRIEVAL_OFFERS } from "../src/retrieval.mjs";
import { representativeCases } from "../src/scifact.mjs";

const document = (id, text, authorizedPrincipals = ["company-a"]) => ({ id, title: "", text,
  authorizedPrincipals, sourceVersion: "v1", location: `urn:fixture:${id}` });
const build = documents => createRetrievalIndex({ documents, principalRef: "company-a", sourceVersion: "v1" });
const search = (index, offer, query, extra = {}) => index.search({ offerRef: offer.offerRef, query,
  requestingPrincipal: "company-a", requiredSourceVersion: "v1", ...extra });

test("Both connectors return ranked provenance and relevant sources", () => {
  const index = build([document("a", "cancer therapy therapy"), document("b", "ocean waves"), document("c", "cancer")]);
  for (const offer of RETRIEVAL_OFFERS) {
    const results = search(index, offer, "therapy");
    assert.equal(results[0].sourceRef, "a");
    assert.equal(results[0].sourceVersion, "v1");
    assert.equal(results[0].location, "urn:fixture:a");
    assert.equal(results[0].rank, 1);
    assert.ok(Number.isFinite(results[0].score) && results[0].score > 0);
    assert.equal(results[0].text, undefined);
  }
});

test("Unauthorized documents do not affect either ranking or scores", () => {
  const visible = [document("a", "cancer therapy"), document("b", "therapy therapy")];
  const base = build(visible);
  const hidden = build([...visible, document("private", "cancer cancer cancer", ["company-b"])]);
  assert.equal(hidden.documentCount, 2);
  for (const offer of RETRIEVAL_OFFERS) assert.deepEqual(search(hidden, offer, "cancer therapy"), search(base, offer, "cancer therapy"));
  assert.throws(() => search(hidden, RETRIEVAL_OFFERS[0], "cancer", { requestingPrincipal: "company-b" }), /Unauthorized/);
});

test("Source versions and authorization are required and copied into immutable index state", () => {
  assert.throws(() => build([{ ...document("a", "word"), authorizedPrincipals: undefined }]));
  assert.throws(() => build([{ ...document("a", "word"), sourceVersion: "old" }]));
  const doc = document("a", "word");
  const index = build([doc]);
  doc.location = "changed";
  assert.equal(search(index, RETRIEVAL_OFFERS[0], "word")[0].location, "urn:fixture:a");
  assert.throws(() => search(index, RETRIEVAL_OFFERS[0], "word", { requiredSourceVersion: "old" }));
});

test("Bounds, unknown queries, deterministic ties and same-ID exclusion", () => {
  const index = build(Array.from({ length: 8 }, (_, i) => document(String(i), "same text")));
  for (const offer of RETRIEVAL_OFFERS) {
    assert.deepEqual(search(index, offer, "same").map(s => s.sourceRef), ["0", "1", "2", "3", "4"]);
    assert.deepEqual(search(index, offer, "same", { excludeSourceRef: "0" }).map(s => s.sourceRef), ["1", "2", "3", "4", "5"]);
    assert.deepEqual(search(index, offer, "unknown"), []);
    assert.deepEqual(search(index, offer, "?!"), []);
    assert.throws(() => search(index, offer, " "));
    assert.throws(() => search(index, offer, "x".repeat(2049)));
    assert.throws(() => search(index, offer, "x ".repeat(257)));
    assert.throws(() => search(index, offer, "same", { limit: 6 }));
  }
  assert.throws(() => index.search({ offerRef: "unknown", query: "same", requestingPrincipal: "company-a", requiredSourceVersion: "v1" }));
  assert.throws(() => build([document("a", "one"), document("a", "two")]));
});

test("Empty authorized corpora abstain without fabricated sources", () => {
  for (const offer of RETRIEVAL_OFFERS) assert.deepEqual(search(build([document("hidden", "word", [])]), offer, "word"), []);
});

test("Representative selection joins transitive overlaps and duplicate queries before evaluation", () => {
  const data = {
    queries: new Map([["1", "one"], ["2", "two"], ["3", "three"], ["4", "FOUR"], ["5", " four "]]),
    gold: new Map([["1", new Set(["a"])], ["2", new Set(["a", "b"])], ["3", new Set(["b"])], ["4", new Set(["c"])], ["5", new Set(["d"])]]),
  };
  assert.deepEqual(representativeCases(data), [
    { representative: "1", members: ["1", "2", "3"] }, { representative: "4", members: ["4", "5"] },
  ]);
});
