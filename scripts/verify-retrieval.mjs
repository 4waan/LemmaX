import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { implementationHashes } from "./benchmark-retrieval.mjs";
import { RETRIEVAL_OFFERS } from "../src/retrieval.mjs";
import { SCIFACT_PROFILE, representativeCases } from "../src/scifact.mjs";

export function verifyRetrievalReport(report) {
  assert.equal(report.schemaVersion, "retrieval-benchmark/v1");
  assert.deepEqual(report.profile, SCIFACT_PROFILE);
  assert.deepEqual(report.codeSha256, implementationHashes());
  assert.equal(report.queryCases, 300);
  assert.equal(report.corpusDocuments, 5183);
  assert.equal(report.perCase.length, report.queryCases);
  assert.equal(new Set(report.perCase.map(row => row.caseRef)).size, report.queryCases);
  assert.equal(report.sourceOutputLimit, 5);
  assert.equal(report.sameIdExclusion, true);
  assert.equal(report.selection.independence, "not_established");
  assert.equal(report.offers.length, RETRIEVAL_OFFERS.length);
  for (const [i, offer] of RETRIEVAL_OFFERS.entries()) {
    for (const [key, value] of Object.entries(offer)) assert.equal(report.offers[i][key], value);
  }
  const membership = new Set();
  const representatives = new Set();
  for (const group of report.selection.groups) {
    assert.ok(group.members.length > 0);
    assert.equal(group.representative, [...group.members].sort()[0]);
    representatives.add(group.representative);
    for (const member of group.members) { assert.ok(!membership.has(member)); membership.add(member); }
  }
  assert.deepEqual([...membership].sort(), report.perCase.map(row => row.caseRef).sort());
  // Reconstruct overlap groups from labels; query-duplicate grouping is verified
  // against the prepared dataset by the separate external benchmark oracle.
  const data = { gold: new Map(report.perCase.map(row => [row.caseRef, new Set(row.relevantSourceRefs)])),
    queries: new Map(report.perCase.map(row => [row.caseRef, row.caseRef])) };
  const sharedGoldGroups = representativeCases(data);
  for (const group of sharedGoldGroups) {
    assert.ok(report.selection.groups.some(actual => group.members.every(member => actual.members.includes(member))));
  }
  const paired = { bothSuccess: 0, onlyFirstSuccess: 0, onlySecondSuccess: 0, bothFailure: 0 };
  const totals = Object.fromEntries(RETRIEVAL_OFFERS.map(o => [o.offerRef, { all: 0, representative: 0 }]));
  for (const row of report.perCase) {
    assert.equal(row.representative, representatives.has(row.caseRef));
    assert.ok(row.relevantSourceRefs.length > 0);
    for (const offer of RETRIEVAL_OFFERS) {
      const output = row.outputs[offer.offerRef];
      assert.ok(output.ranking.length <= 5);
      assert.equal(new Set(output.ranking).size, output.ranking.length);
      assert.ok(!output.ranking.includes(row.caseRef));
      assert.equal(output.scores.length, output.ranking.length);
      assert.ok(output.scores.every(score => Number.isFinite(score) && score >= 0));
      assert.equal(output.success, output.ranking.some(id => row.relevantSourceRefs.includes(id)));
      totals[offer.offerRef].all += Number(output.success);
      totals[offer.offerRef].representative += Number(row.representative && output.success);
    }
    const [a, b] = RETRIEVAL_OFFERS.map(o => row.outputs[o.offerRef].success);
    paired[a ? b ? "bothSuccess" : "onlyFirstSuccess" : b ? "onlySecondSuccess" : "bothFailure"]++;
  }
  for (const offer of report.offers) {
    assert.equal(offer.successes, totals[offer.offerRef].all);
    assert.equal(offer.failures, report.queryCases - offer.successes);
    assert.equal(offer.cases, report.queryCases);
    assert.equal(offer.observedHitRate, offer.successes / report.queryCases);
    assert.equal(offer.representativeCases, representatives.size);
    assert.equal(offer.representativeSuccesses, totals[offer.offerRef].representative);
    assert.equal(offer.representativeFailures, representatives.size - offer.representativeSuccesses);
    for (const key of ["localMeanQueryMs", "localP95QueryMs", "measuredCpuMicroseconds"]) assert.ok(Number.isFinite(offer[key]) && offer[key] >= 0);
    assert.equal(offer.paidApiCalls, 0); assert.equal(offer.trainingRuns, 0);
  }
  assert.deepEqual(report.paired, paired);
  assert.ok(Number.isSafeInteger(report.observedAt) && report.observedAt >= 0);
  return { casesChecked: report.queryCases, offersChecked: report.offers.length, representativeCases: representatives.size,
    paired, limitation: "Checks stored relevance arithmetic, group consistency and code binding. Does not certify labels, independence or throughput." };
}

export function loadRetrievalReport() {
  const report = JSON.parse(readFileSync(new URL("../benchmarks/retrieval-paired-results.json", import.meta.url), "utf8"));
  verifyRetrievalReport(report);
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyRetrievalReport(loadRetrievalReport()), null, 2));
