import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { digest, createRetrievalIndex } from "./retrieval.mjs";

export const SCIFACT_PROFILE = Object.freeze({
  profileRef: "beir-scifact-test-source-hit5/v1",
  principalRef: "public-scifact-demo",
  corpusSha256: "dec31c8182f3d744c7d2c09423756fd1d17cbef75808db13ba01cc0aab4d1ac6",
  queriesSha256: "8ff84a7c903f722981cd8d595c022660140c51867b27608a6d4910db86080313",
  qrelsSha256: "0864bb985e0ca2367ba217977e72004d549054b2b06666ed9d4825ac7c21284c",
});
export const BENCHMARK_CONTEXT = Object.freeze({
  outcomeSpecRef: "public-labeled-relevant-source-at5/v1",
  contextRef: SCIFACT_PROFILE.profileRef,
  evidenceKind: "capability_benchmark",
});

export function loadSciFact(directory) {
  if (typeof directory !== "string" || !directory) throw new TypeError("Set LEMMAX_SCIFACT_DIR to prepared public benchmark data");
  function verified(name, hash) {
    const path = join(directory, name);
    if (statSync(path).size > 20000000) throw new RangeError("Benchmark file too large");
    const raw = readFileSync(path);
    if (digest(raw) !== hash) throw new TypeError("Benchmark data hash mismatch");
    return raw.toString("utf8");
  }
  const corpusRaw = verified("corpus.jsonl", SCIFACT_PROFILE.corpusSha256);
  const queriesRaw = verified("queries.jsonl", SCIFACT_PROFILE.queriesSha256);
  const qrelsRaw = verified("test.tsv", SCIFACT_PROFILE.qrelsSha256);
  const documents = corpusRaw.trim().split("\n").map(line => {
    const doc = JSON.parse(line);
    return { id: String(doc._id), title: doc.title, text: doc.text,
      authorizedPrincipals: [SCIFACT_PROFILE.principalRef], sourceVersion: SCIFACT_PROFILE.corpusSha256,
      location: `urn:beir:scifact:${doc._id}` };
  });
  const queries = new Map(queriesRaw.trim().split("\n").map(line => {
    const q = JSON.parse(line); return [String(q._id), q.text];
  }));
  const gold = new Map();
  const lines = qrelsRaw.trim().split(/\r?\n/);
  if (lines.shift() !== "query-id\tcorpus-id\tscore") throw new TypeError("Unsupported qrels header");
  const ids = new Set(documents.map(d => d.id));
  for (const line of lines) {
    const [query, doc, score] = line.split("\t");
    if (score !== "1" || !queries.has(query) || !ids.has(doc)) throw new TypeError("Invalid relevance record");
    if (!gold.has(query)) gold.set(query, new Set());
    gold.get(query).add(doc);
  }
  return { documents, queries, gold };
}

export function createSciFactIndex(data) {
  return createRetrievalIndex({ documents: data.documents,
    principalRef: SCIFACT_PROFILE.principalRef, sourceVersion: SCIFACT_PROFILE.corpusSha256 });
}

// Public labels define potential correlation groups before either connector runs.
// Select one query per connected shared-gold or duplicate-normalized-query group.
// This removes known overlap; it cannot establish statistical independence.
export function representativeCases(data) {
  const ids = [...data.gold.keys()].sort();
  const parent = new Map(ids.map(id => [id, id]));
  function root(id) { while (parent.get(id) !== id) id = parent.get(id); return id; }
  const owners = new Map();
  for (const id of ids) {
    const keys = [...data.gold.get(id)].map(doc => `gold:${doc}`);
    keys.push(`query:${data.queries.get(id).toLowerCase().replace(/\s+/g, " ").trim()}`);
    for (const key of keys) {
      if (owners.has(key)) parent.set(root(id), root(owners.get(key)));
      else owners.set(key, id);
    }
  }
  const groups = new Map();
  for (const id of ids) {
    const r = root(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(id);
  }
  return [...groups.values()].map(group => ({ representative: group[0], members: group })).sort((a, b) => a.representative < b.representative ? -1 : 1);
}
