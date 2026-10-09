import { createHash } from "node:crypto";

export const RETRIEVAL_OFFERS = Object.freeze([
  Object.freeze({ offerRef: "lemmax/bm25-source-retrieval/v1", method: "bm25", k1: 1.2, b: 0.75 }),
  Object.freeze({ offerRef: "lemmax/tfidf-source-retrieval/v1", method: "tfidf_cosine" }),
]);
export const tokenize = text => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
export const digest = data => createHash("sha256").update(data).digest("hex");

function identifier(value, name) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new TypeError(`Invalid ${name}`);
}

// Build only from the authenticated principal's authorized corpus. This also
// prevents hidden documents from affecting IDF statistics or visible scores.
export function createRetrievalIndex({ documents, principalRef, sourceVersion }) {
  identifier(principalRef, "principalRef");
  identifier(sourceVersion, "sourceVersion");
  if (!Array.isArray(documents) || documents.length > 100000) throw new RangeError("Unsupported corpus size");
  const ids = new Set();
  const permitted = [];
  for (const doc of documents) {
    identifier(doc.id, "document id");
    if (ids.has(doc.id)) throw new TypeError("Duplicate document id");
    ids.add(doc.id);
    if (!Array.isArray(doc.authorizedPrincipals)) throw new TypeError("Document authorization must be explicit");
    if (!doc.authorizedPrincipals.includes(principalRef)) continue;
    if (doc.sourceVersion !== sourceVersion) throw new TypeError("Stale source version");
    if (typeof doc.title !== "string" || typeof doc.text !== "string" || doc.text.length + doc.title.length > 200000) throw new TypeError("Invalid document text");
    identifier(doc.location, "source location");
    permitted.push(doc);
  }
  const postings = new Map();
  const lengths = new Map();
  const metadata = new Map();
  for (const doc of permitted) {
    const frequencies = new Map();
    for (const term of tokenize(`${doc.title} ${doc.text}`)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    lengths.set(doc.id, [...frequencies.values()].reduce((a, b) => a + b, 0));
    metadata.set(doc.id, { sourceRef: doc.id, sourceVersion, location: doc.location });
    for (const [term, frequency] of frequencies) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push([doc.id, frequency]);
    }
  }
  const count = permitted.length;
  const averageLength = count ? [...lengths.values()].reduce((a, b) => a + b, 0) / count : 0;
  const norms = new Map();
  for (const entries of postings.values()) {
    const idf = Math.log((1 + count) / (1 + entries.length)) + 1;
    for (const [id, frequency] of entries) {
      const weight = (1 + Math.log(frequency)) * idf;
      norms.set(id, (norms.get(id) ?? 0) + weight * weight);
    }
  }
  for (const [id, value] of norms) norms.set(id, Math.sqrt(value));

  return Object.freeze({
    documentCount: count, principalRef, sourceVersion,
    search({ offerRef, query, requestingPrincipal, requiredSourceVersion, excludeSourceRef = null, limit = 5 }) {
      if (requestingPrincipal !== principalRef) throw new TypeError("Unauthorized principal");
      if (requiredSourceVersion !== sourceVersion) throw new TypeError("Source version mismatch");
      const offer = RETRIEVAL_OFFERS.find(o => o.offerRef === offerRef);
      if (!offer) throw new TypeError("Unknown retrieval offer");
      if (typeof query !== "string" || !query.trim() || query.length > 2048) throw new TypeError("Query must contain 1 to 2048 characters");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new RangeError("Return at most five sources");
      const terms = tokenize(query);
      if (terms.length > 256) throw new RangeError("Too many query terms");
      const scores = new Map();
      const frequencies = new Map();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      let queryNormSquared = 0;
      for (const term of [...frequencies.keys()].sort()) {
        const entries = postings.get(term) ?? [];
        if (offer.method === "bm25") {
          const idf = Math.log1p((count - entries.length + 0.5) / (entries.length + 0.5));
          for (const [id, frequency] of entries) {
            if (id === excludeSourceRef) continue;
            const denominator = frequency + offer.k1 * (1 - offer.b + offer.b * lengths.get(id) / averageLength);
            scores.set(id, (scores.get(id) ?? 0) + idf * frequency * (offer.k1 + 1) / denominator);
          }
        } else {
          const idf = Math.log((1 + count) / (1 + entries.length)) + 1;
          const queryWeight = (1 + Math.log(frequencies.get(term))) * idf;
          queryNormSquared += queryWeight * queryWeight;
          for (const [id, frequency] of entries) {
            if (id === excludeSourceRef) continue;
            const docWeight = (1 + Math.log(frequency)) * idf;
            scores.set(id, (scores.get(id) ?? 0) + queryWeight * docWeight);
          }
        }
      }
      if (offer.method === "tfidf_cosine") {
        const queryNorm = Math.sqrt(queryNormSquared);
        for (const [id, score] of scores) scores.set(id, score / (queryNorm * norms.get(id)));
      }
      return [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, limit).map(([id, score], i) => ({ ...metadata.get(id), rank: i + 1, score }));
    },
  });
}
