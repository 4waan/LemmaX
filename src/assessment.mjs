import { betaQuantile, validateBetaParameters } from "./beta.mjs";

function identifier(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
}

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
}

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
}

function probability(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Probability must be in [0, 1]");
}

function finiteResult(value) {
  if (!Number.isFinite(value)) throw new RangeError("Arithmetic overflow");
  return value;
}

function unknown(reasons) {
  return { status: "insufficient_evidence", mean: null, interval: null, reasons };
}

function validatePolicy(policy) {
  identifier(policy.policyRef, "policyRef");
  validateBetaParameters(policy.alpha, policy.beta);
  if (!Number.isFinite(policy.coverage) || policy.coverage <= 0 || policy.coverage >= 1) {
    throw new RangeError("Interval coverage must be between zero and one");
  }
  count(policy.minimumCases, "minimumCases");
  if (policy.minimumCases < 1) throw new RangeError("At least one observed case is required");
  count(policy.maximumAgeSeconds, "maximumAgeSeconds");
}

function validateContext(context) {
  for (const key of ["outcomeSpecRef", "contextRef"]) identifier(context[key], key);
  if (!["capability_benchmark", "acceptance_attempt"].includes(context.evidenceKind)) {
    throw new TypeError("Forecast kind must be capability_benchmark or acceptance_attempt");
  }
}

// This boundary consumes an already authorized, admitted server-side snapshot.
// It does not establish evaluator authority or accept trusted counts from an API caller.
export function estimateOutcome(context, offerRef, snapshot, policy, asOf) {
  validateContext(context);
  identifier(offerRef, "offerRef");
  validatePolicy(policy);
  count(asOf, "asOf");
  if (!snapshot) return unknown(["missing_snapshot"]);
  for (const key of ["offerRef", "outcomeSpecRef", "contextRef", "evidenceKind"]) {
    const expected = key === "offerRef" ? offerRef : context[key];
    if (snapshot[key] !== expected) return unknown([`mismatched_${key}`]);
  }
  if (snapshot.policyRef !== policy.policyRef) return unknown(["mismatched_policyRef"]);
  identifier(snapshot.snapshotRef, "snapshotRef");
  for (const key of ["successes", "failures", "unresolved", "observedAt"]) count(snapshot[key], key);
  if (snapshot.observedAt > asOf) return unknown(["future_snapshot"]);
  if (asOf - snapshot.observedAt > policy.maximumAgeSeconds) return unknown(["stale_snapshot"]);
  if (snapshot.complete !== true || snapshot.unresolved > 0) return unknown(["incomplete_cohort"]);
  if (snapshot.independentUnits !== true) return unknown(["unsupported_independence"]);
  const n = snapshot.successes + snapshot.failures;
  if (!Number.isSafeInteger(n)) throw new RangeError("Case count overflow");
  if (n < policy.minimumCases) return unknown(["below_evidence_minimum"]);
  const a = policy.alpha + snapshot.successes;
  const b = policy.beta + snapshot.failures;
  if (a + b > 10000) return unknown(["numerical_domain_limit"]);
  const tail = (1 - policy.coverage) / 2;
  return {
    status: "estimated",
    mean: a / (a + b),
    interval: {
      method: "beta_equal_tail_credible",
      coverage: policy.coverage,
      low: betaQuantile(tail, a, b),
      high: betaQuantile(1 - tail, a, b),
    },
    prior: { alpha: policy.alpha, beta: policy.beta },
    evidence: {
      snapshotRef: snapshot.snapshotRef, policyRef: snapshot.policyRef,
      kind: snapshot.evidenceKind, successes: snapshot.successes, failures: snapshot.failures,
      observedAt: snapshot.observedAt,
    },
    calibrationStatus: "not_established",
    reasons: [],
  };
}

const BUYER_FIELDS = [
  "attemptOverhead", "purchasePrice", "failureRetention", "fallbackOnFailure", "lossOnFailure", "directCost",
];
const OPERATOR_FIELDS = [
  "successShare", "earnedServiceFees", "deliveryCost", "subsidy", "evidenceCost", "expectedPaidAttempts", "minimumContribution",
];

function missingFields(input, fields) {
  return fields.filter((key) => input?.[key] === null || input?.[key] === undefined);
}

function validateBuyer(costs) {
  identifier(costs.currency, "currency");
  identifier(costs.assumptionRef, "assumptionRef");
  for (const key of BUYER_FIELDS) nonnegative(costs[key], key);
  if (costs.failureRetention > costs.purchasePrice) throw new RangeError("Failure retention exceeds principal");
}

// Forecast units are decimal currency amounts. Settlement must use atomic integers separately.
export function expectedCompletionCost(p, costs) {
  probability(p);
  validateBuyer(costs);
  return finiteResult(costs.attemptOverhead + p * costs.purchasePrice
    + (1 - p) * (costs.failureRetention + costs.fallbackOnFailure + costs.lossOnFailure));
}

export function contribution(p, purchasePrice, costs) {
  probability(p);
  nonnegative(purchasePrice, "purchasePrice");
  identifier(costs.currency, "operator currency");
  identifier(costs.termsRef, "termsRef");
  for (const key of OPERATOR_FIELDS) nonnegative(costs[key], key);
  probability(costs.successShare);
  if (costs.expectedPaidAttempts <= 0) throw new RangeError("Expected paid evidence reuse must be positive");
  return finiteResult(p * costs.successShare * purchasePrice + costs.earnedServiceFees
    - costs.deliveryCost - costs.subsidy - costs.evidenceCost / costs.expectedPaidAttempts);
}

export function assess({ context, policy, asOf, offers }) {
  validateContext(context);
  validatePolicy(policy);
  count(asOf, "asOf");
  if (!Array.isArray(offers) || offers.length > 100) throw new RangeError("At most 100 offers per assessment");
  const seen = new Set();
  const results = offers.map((offer) => {
    identifier(offer.offerRef, "offerRef");
    if (seen.has(offer.offerRef)) throw new TypeError("Duplicate offerRef");
    seen.add(offer.offerRef);
    if (!["eligible", "ineligible", "needs_check"].includes(offer.eligibility)) throw new TypeError("Invalid eligibility");
    const reasons = [];
    const result = {
      offerRef: offer.offerRef, eligibility: offer.eligibility,
      pOutcome: unknown(["eligibility_not_confirmed"]),
      cReuse: null, costInterval: null, expectedSaving: null, currency: null,
      contribution: null, serviceAvailability: "unknown", rank: null, reasons,
    };
    if (offer.eligibility !== "eligible") {
      reasons.push("eligibility_not_confirmed");
      return result;
    }
    result.pOutcome = estimateOutcome(context, offer.offerRef, offer.snapshot, policy, asOf);
    if (result.pOutcome.mean === null) {
      reasons.push(...result.pOutcome.reasons);
      return result;
    }
    const missingBuyer = missingFields(offer.buyerCosts, [...BUYER_FIELDS, "currency", "assumptionRef"]);
    if (missingBuyer.length) {
      reasons.push(...missingBuyer.map((key) => `missing_buyer_${key}`));
      return result;
    }
    result.currency = offer.buyerCosts.currency;
    result.cReuse = expectedCompletionCost(result.pOutcome.mean, offer.buyerCosts);
    const first = expectedCompletionCost(result.pOutcome.interval.low, offer.buyerCosts);
    const last = expectedCompletionCost(result.pOutcome.interval.high, offer.buyerCosts);
    result.costInterval = { low: Math.min(first, last), high: Math.max(first, last), scope: "probability_only" };
    result.expectedSaving = finiteResult(offer.buyerCosts.directCost - result.cReuse);
    const missingOperator = missingFields(offer.operatorCosts, [...OPERATOR_FIELDS, "currency", "termsRef"]);
    if (missingOperator.length) {
      reasons.push(...missingOperator.map((key) => `missing_operator_${key}`));
      return result;
    }
    if (offer.operatorCosts.currency !== result.currency) throw new TypeError("Buyer and operator currencies must match");
    result.contribution = contribution(result.pOutcome.mean, offer.buyerCosts.purchasePrice, offer.operatorCosts);
    result.serviceAvailability = result.contribution >= offer.operatorCosts.minimumContribution ? "available" : "unavailable";
    if (result.serviceAvailability === "unavailable") reasons.push("below_contribution_floor");
    return result;
  });
  const ranked = results.filter((r) => r.cReuse !== null && r.serviceAvailability === "available");
  if (new Set(ranked.map((r) => r.currency)).size > 1) throw new TypeError("Cannot rank different currencies");
  ranked.sort((a, b) => a.cReuse - b.cReuse || (a.offerRef < b.offerRef ? -1 : a.offerRef > b.offerRef ? 1 : 0));
  ranked.forEach((result, index) => { result.rank = index + 1; });
  return { schemaVersion: "0.1.0", context: { ...context }, policyRef: policy.policyRef, asOf, results };
}
