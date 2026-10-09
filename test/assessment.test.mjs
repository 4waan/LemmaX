import test from "node:test";
import assert from "node:assert/strict";
import { assess, contribution, estimateOutcome, expectedCompletionCost } from "../src/assessment.mjs";
import { betaCdf, betaQuantile } from "../src/beta.mjs";

const context = { outcomeSpecRef: "retrieval/v1", contextRef: "corpus-runtime/v1", evidenceKind: "capability_benchmark" };
const policy = { policyRef: "test-policy/v1", alpha: 1, beta: 1, coverage: 0.95, minimumCases: 10, maximumAgeSeconds: 100 };
const asOf = 1000;
function snapshot(id = "a/v1") {
  return { ...context, offerRef: id, snapshotRef: "test-snapshot/v1", policyRef: policy.policyRef,
    successes: 80, failures: 20, unresolved: 0, observedAt: 950, independentUnits: true, complete: true };
}
function buyer() {
  return { currency: "TEST_UNITS", assumptionRef: "test-assumptions/v1", attemptOverhead: 2,
    purchasePrice: 10, failureRetention: 0, fallbackOnFailure: 20, lossOnFailure: 3, directCost: 30 };
}
function operator() {
  return { currency: "TEST_UNITS", termsRef: "test-terms/v1", successShare: 0.1,
    earnedServiceFees: 2, deliveryCost: 0.5, subsidy: 0.25, evidenceCost: 10,
    expectedPaidAttempts: 100, minimumContribution: 0 };
}
function offer(id = "a/v1") {
  return { offerRef: id, eligibility: "eligible", snapshot: snapshot(id), buyerCosts: buyer(), operatorCosts: operator() };
}
function evaluate(offers) { return assess({ context, policy, asOf, offers }).results; }
function close(actual, expected, tolerance = 1e-11) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }

test("Beta quantiles agree with closed-form distributions", () => {
  for (const p of [0.001, 0.025, 0.5, 0.975, 0.999]) {
    close(betaQuantile(p, 1, 1), p);
    close(betaQuantile(p, 2, 1), Math.sqrt(p));
    close(betaQuantile(p, 1, 2), 1 - Math.sqrt(1 - p));
    close(betaQuantile(p, 0.5, 0.5), Math.sin(Math.PI * p / 2) ** 2);
  }
});
test("Beta endpoint and numerical-domain guards", () => {
  assert.equal(betaQuantile(0, 1, 1), 0);
  assert.equal(betaQuantile(1, 1, 1), 1);
  assert.throws(() => betaQuantile(NaN, 1, 1));
  assert.throws(() => betaCdf(0.5, 0.1, 1));
  assert.throws(() => betaQuantile(0.5, 6000, 6000));
});
test("Credible interval is symmetric for symmetric observations", () => {
  const p = estimateOutcome(context, "a/v1", { ...snapshot(), successes: 50, failures: 50 }, policy, asOf);
  assert.equal(p.mean, 0.5);
  close(p.interval.low + p.interval.high, 1);
  assert.equal(p.calibrationStatus, "not_established");
});
test("Unknown evidence is null and unranked, rather than a zero forecast", () => {
  const r = evaluate([{ ...offer(), snapshot: null }])[0];
  assert.equal(r.pOutcome.mean, null);
  assert.equal(r.pOutcome.interval, null);
  assert.equal(r.rank, null);
});
test("Prior-only observations never become an empirical estimate", () => {
  const r = estimateOutcome(context, "a/v1", { ...snapshot(), successes: 0, failures: 0 }, policy, asOf);
  assert.equal(r.mean, null);
});
test("Every outcome/profile/version/evidence-policy mismatch blocks the estimate", () => {
  for (const key of ["offerRef", "outcomeSpecRef", "contextRef", "evidenceKind", "policyRef"]) {
    const r = estimateOutcome(context, "a/v1", { ...snapshot(), [key]: "different" }, policy, asOf);
    assert.equal(r.mean, null, key);
  }
});
test("Unresolved or incomplete cohorts are not published as success-only samples", () => {
  for (const change of [{ unresolved: 1 }, { complete: false }, { independentUnits: false }]) {
    assert.equal(estimateOutcome(context, "a/v1", { ...snapshot(), ...change }, policy, asOf).mean, null);
  }
});
test("Freshness includes the boundary and rejects future snapshots", () => {
  assert.notEqual(estimateOutcome(context, "a/v1", { ...snapshot(), observedAt: 900 }, policy, asOf).mean, null);
  assert.equal(estimateOutcome(context, "a/v1", { ...snapshot(), observedAt: 899 }, policy, asOf).mean, null);
  assert.equal(estimateOutcome(context, "a/v1", { ...snapshot(), observedAt: 1001 }, policy, asOf).mean, null);
});
test("Case counts and prior configuration cannot be silently coerced", () => {
  assert.throws(() => estimateOutcome(context, "a/v1", { ...snapshot(), successes: "80" }, policy, asOf));
  assert.throws(() => estimateOutcome(context, "a/v1", snapshot(), { ...policy, minimumCases: 0 }, asOf));
  assert.throws(() => estimateOutcome(context, "a/v1", snapshot(), { ...policy, coverage: 1 }, asOf));
});
test("Numerically unsupported evidence remains unknown", () => {
  const r = estimateOutcome(context, "a/v1", { ...snapshot(), successes: 10000 }, policy, asOf);
  assert.equal(r.mean, null);
  assert.deepEqual(r.reasons, ["numerical_domain_limit"]);
});
test("Expected cost matches hand-calculated success, failure and mixed cases", () => {
  close(expectedCompletionCost(1, buyer()), 12);
  close(expectedCompletionCost(0, buyer()), 25);
  close(expectedCompletionCost(0.9, buyer()), 13.3);
  close(expectedCompletionCost(0.2, buyer()), 22.4);
  close(expectedCompletionCost(0.2, { ...buyer(), failureRetention: 4 }), 25.6);
});
test("Contribution excludes publisher principal and allocates evidence expense once", () => {
  close(contribution(0.8, 10, operator()), 1.95);
  close(contribution(0, 10, operator()), 1.15);
  assert.throws(() => contribution(0.8, 10, { ...operator(), expectedPaidAttempts: 0 }));
  assert.throws(() => contribution(0.8, 10, { ...operator(), successShare: 1.1 }));
});
test("Unknown material buyer costs suppress cost and rank", () => {
  for (const key of ["attemptOverhead", "purchasePrice", "failureRetention", "fallbackOnFailure", "lossOnFailure", "directCost"]) {
    const input = offer(); input.buyerCosts[key] = null;
    const r = evaluate([input])[0];
    assert.equal(r.cReuse, null, key);
    assert.equal(r.rank, null, key);
  }
});
test("Ineligible and unchecked candidates have no forecast or cost rank", () => {
  for (const eligibility of ["ineligible", "needs_check"]) {
    const r = evaluate([{ ...offer(), eligibility }])[0];
    assert.equal(r.pOutcome.mean, null);
    assert.equal(r.rank, null);
  }
});
test("Missing operator terms do not imply commercially available service", () => {
  const r = evaluate([{ ...offer(), operatorCosts: null }])[0];
  assert.notEqual(r.cReuse, null);
  assert.equal(r.serviceAvailability, "unknown");
  assert.equal(r.rank, null);
});
test("Contribution floor governs availability without editing the probability", () => {
  const input = offer(); input.operatorCosts.minimumContribution = 100;
  const r = evaluate([input])[0];
  close(r.pOutcome.mean, 81 / 102);
  assert.equal(r.serviceAvailability, "unavailable");
  assert.equal(r.rank, null);
});
test("Rank is expected-cost order, with deterministic identifier ties", () => {
  const a = offer("z/v1"); const b = offer("a/v1"); const c = offer("cheap/v1");
  c.buyerCosts.purchasePrice = 1;
  const r = evaluate([a, b, c]);
  assert.deepEqual(r.map((x) => x.rank), [3, 2, 1]);
  const reversed = evaluate([c, b, a]);
  assert.deepEqual(reversed.map((x) => x.rank), [1, 2, 3]);
});
test("Cost interval handles either direction of probability effect", () => {
  for (const price of [1, 100]) {
    const input = offer(); input.buyerCosts.purchasePrice = price;
    const r = evaluate([input])[0];
    assert.ok(r.costInterval.low <= r.cReuse && r.cReuse <= r.costInterval.high);
    const slope = price - 23;
    const expectedWidth = Math.abs(slope) * (r.pOutcome.interval.high - r.pOutcome.interval.low);
    close(r.costInterval.high - r.costInterval.low, expectedWidth);
  }
});
test("Currency mismatch cannot yield a cross-currency ranking", () => {
  const input = offer(); input.operatorCosts.currency = "OTHER";
  assert.throws(() => evaluate([input]));
  const other = offer("b/v1"); other.buyerCosts.currency = "OTHER"; other.operatorCosts.currency = "OTHER";
  assert.throws(() => evaluate([offer(), other]));
});
test("Negative, nonfinite and excessive retained-principal inputs are rejected", () => {
  for (const bad of [-1, Infinity, NaN, "2"]) assert.throws(() => expectedCompletionCost(0.8, { ...buyer(), attemptOverhead: bad }));
  assert.throws(() => expectedCompletionCost(0.8, { ...buyer(), failureRetention: 11 }));
  assert.throws(() => expectedCompletionCost(0.8, { ...buyer(), attemptOverhead: 1e308, purchasePrice: 1e308 }));
});
test("Duplicate offers and conformance-only forecasts are rejected", () => {
  assert.throws(() => evaluate([offer(), offer()]));
  assert.throws(() => assess({ context: { ...context, evidenceKind: "deployment_conformance" }, policy, asOf, offers: [offer()] }));
});
test("Assessment is reproducible without mutating frozen input", () => {
  function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const input = freeze({ context, policy, asOf, offers: [offer()] });
  assert.deepEqual(assess(input), assess(input));
  assert.doesNotThrow(() => JSON.stringify(assess(input)));
});
