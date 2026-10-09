import test from "node:test";
import assert from "node:assert/strict";
import { priceBillingPlan, assessBillingPlans } from "../src/billing.mjs";

const workload = { workloadRef: "test-workload", horizonRef: "test-period", billingMeterRef: "request/v1", taskCount: 100, usageUnits: 100, costBasis: "incremental" };
function plan() {
  return { planRef: "test-plan", horizonRef: workload.horizonRef, billingMeterRef: workload.billingMeterRef,
    currency: "TEST_UNITS", billingModel: "subscription", access: "new", fixedFee: 30, includedUnits: 80,
    unitPrice: 0.2, setupCost: 5, quotaOpportunityCost: 1, overageAllowed: true };
}
function owned() {
  const p = { ...plan(), access: "existing" };
  p.entitlementSnapshot = { planRef: p.planRef, horizonRef: p.horizonRef, billingMeterRef: p.billingMeterRef,
    snapshotRef: "test-entitlement", authorized: true, coverageConfirmed: true, remainingUnits: 90, reservedUnits: 20 };
  return p;
}
function candidate(id, billingPlan) {
  return { offerRef: id, eligibility: "eligible", billingPlan,
    snapshot: { offerRef: id, outcomeSpecRef: "retrieval/v1", contextRef: "test-profile", evidenceKind: "capability_benchmark",
      snapshotRef: "test-evidence", policyRef: "test-policy", successes: 90, failures: 10, unresolved: 0,
      independentUnits: true, complete: true, observedAt: 100 },
    buyerCosts: { currency: "TEST_UNITS", assumptionRef: "test-base-costs", attemptOverhead: 0.05,
      purchasePrice: 0, failureRetention: 0, fallbackOnFailure: 1, lossOnFailure: 0, directCost: 1 },
    operatorCosts: { currency: "TEST_UNITS", termsRef: "test-operator", successShare: 0, earnedServiceFees: 0.05,
      deliveryCost: 0.01, subsidy: 0, evidenceCost: 0, expectedPaidAttempts: 100, minimumContribution: 0 } };
}
function assess(offers, w = workload) {
  return assessBillingPlans({ workload: w, offers,
    context: { outcomeSpecRef: "retrieval/v1", contextRef: "test-profile", evidenceKind: "capability_benchmark" },
    policy: { policyRef: "test-policy", alpha: 1, beta: 1, coverage: 0.95, minimumCases: 10, maximumAgeSeconds: 100 }, asOf: 100 });
}

test("New plan charges one fixed fee and only overage beyond included allowance", () => {
  const result = priceBillingPlan(workload, plan());
  assert.equal(result.fixedFeeApplied, 30);
  assert.equal(result.usageCharge, 4);
  assert.equal(result.totalAccessCost, 40);
  assert.equal(result.perCaseAccessCost, 0.4);
});
test("Existing entitlement excludes sunk fee and reserved quota", () => {
  const result = priceBillingPlan(workload, owned());
  assert.equal(result.fixedFeeApplied, 0);
  assert.equal(result.allowanceAvailable, 70);
  assert.equal(result.usageCharge, 6);
  assert.equal(result.totalAccessCost, 12);
});
test("Owned subscription has no extra access charge inside available allowance", () => {
  const p = owned(); p.setupCost = 0; p.quotaOpportunityCost = 0;
  assert.equal(priceBillingPlan({ ...workload, usageUnits: 70 }, p).totalAccessCost, 0);
  assert.equal(priceBillingPlan({ ...workload, usageUnits: 71 }, p).totalAccessCost, 0.2);
});
test("Acquisition view cannot use old entitlement as a free renewal quote", () => {
  assert.equal(priceBillingPlan({ ...workload, costBasis: "acquisition" }, owned()).status, "needs_check");
  assert.equal(priceBillingPlan({ ...workload, costBasis: "acquisition" }, plan()).fixedFeeApplied, 30);
});
test("Pay-as-you-go ignores subscription-only fields", () => {
  const p = { ...plan(), billingModel: "pay_as_you_go" };
  assert.equal(priceBillingPlan(workload, p).totalAccessCost, 26);
});
test("Quota exhaustion without overage makes a plan ineligible", () => {
  assert.equal(priceBillingPlan(workload, { ...plan(), overageAllowed: false }).status, "ineligible");
  assert.equal(priceBillingPlan({ ...workload, usageUnits: 80 }, { ...plan(), overageAllowed: false }).status, "priced");
});
test("Missing tariff or entitlement never becomes a zero cost", () => {
  for (const p of [null, { ...plan(), fixedFee: null }, { ...plan(), unitPrice: null }, { ...owned(), entitlementSnapshot: null }]) {
    const result = priceBillingPlan(workload, p);
    assert.equal(result.status, "needs_check");
    assert.equal(result.totalAccessCost, null);
  }
});
test("Wrong period, meter, authority or snapshot context blocks pricing", () => {
  for (const key of ["horizonRef", "billingMeterRef"]) {
    assert.equal(priceBillingPlan(workload, { ...plan(), [key]: "other" }).status, "needs_check");
  }
  for (const key of ["planRef", "horizonRef", "billingMeterRef", "authorized", "coverageConfirmed"]) {
    const p = owned(); p.entitlementSnapshot[key] = key.endsWith("Ref") ? "other" : false;
    assert.equal(priceBillingPlan(workload, p).status, "needs_check");
  }
});
test("Malformed quantities and overflow are rejected", () => {
  for (const n of [0, -1, 0.5, NaN]) assert.throws(() => priceBillingPlan({ ...workload, taskCount: n }, plan()));
  assert.throws(() => priceBillingPlan({ ...workload, usageUnits: -1 }, plan()));
  assert.throws(() => priceBillingPlan(workload, { ...plan(), unitPrice: Infinity }));
  assert.throws(() => priceBillingPlan({ ...workload, usageUnits: 1e308 }, { ...plan(), unitPrice: 1e308 }));
  const p = owned(); p.entitlementSnapshot.reservedUnits = 91;
  assert.throws(() => priceBillingPlan(workload, p));
});
test("Assessment ranks plans by workload-adjusted expected cost with unchanged quality evidence", () => {
  const result = assess([candidate("new/v1", plan()), candidate("existing/v1", owned())]);
  assert.deepEqual(result.results.map((r) => r.rank), [2, 1]);
  assert.deepEqual(result.results[0].pOutcome.interval, result.results[1].pOutcome.interval);
  assert.equal(result.results[0].pOutcome.mean, result.results[1].pOutcome.mean);
  assert.ok(Math.abs(result.results[0].cReuse - result.results[1].cReuse - 0.28) < 1e-12);
});
test("Unknown and ineligible billing are unranked", () => {
  const result = assess([candidate("unknown/v1", null), candidate("limited/v1", { ...plan(), overageAllowed: false })]);
  assert.deepEqual(result.results.map((r) => r.rank), [null, null]);
  assert.deepEqual(result.results.map((r) => r.eligibility), ["needs_check", "ineligible"]);
});
test("Billing currency must match cost and operator terms", () => {
  assert.throws(() => assess([candidate("a/v1", { ...plan(), currency: "OTHER" })]));
});
test("Missing base cost stays unknown and inputs are not mutated", () => {
  const c = candidate("a/v1", plan()); c.buyerCosts.attemptOverhead = null;
  const before = JSON.stringify(c);
  const result = assess([c]);
  assert.equal(result.results[0].cReuse, null);
  assert.equal(JSON.stringify(c), before);
});
