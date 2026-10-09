import { assess } from "../src/assessment.mjs";

const context = {
  outcomeSpecRef: "synthetic-retrieval-case/v1",
  contextRef: "synthetic-corpus-runtime/v1",
  evidenceKind: "capability_benchmark",
};
const asOf = 1791504000;
const policy = {
  policyRef: "synthetic-policy/v1", alpha: 1, beta: 1, coverage: 0.95,
  minimumCases: 30, maximumAgeSeconds: 86400,
};

function offer(id, successes, price) {
  return {
    offerRef: id,
    eligibility: "eligible",
    snapshot: {
      ...context, offerRef: id, policyRef: policy.policyRef,
      snapshotRef: `synthetic-snapshot/${id}`, successes, failures: 100 - successes,
      unresolved: 0, independentUnits: true, complete: true, observedAt: asOf,
    },
    buyerCosts: {
      currency: "DEMO_UNITS", assumptionRef: "synthetic-costs/v1",
      attemptOverhead: 0.02, purchasePrice: price, failureRetention: 0,
      fallbackOnFailure: 1, lossOnFailure: 0, directCost: 1,
    },
    operatorCosts: {
      currency: "DEMO_UNITS", termsRef: "synthetic-commercial-terms/v1",
      successShare: 0.1, earnedServiceFees: 0.02, deliveryCost: 0.01,
      subsidy: 0, evidenceCost: 1, expectedPaidAttempts: 100, minimumContribution: 0,
    },
  };
}

const input = {
  context, policy, asOf,
  offers: [
    offer("synthetic-offer-a/v1", 84, 0.3),
    offer("synthetic-offer-b/v1", 5, 0.05),
    offer("synthetic-offer-c/v1", 11, 0.1),
    { offerRef: "unmeasured-offer/v1", eligibility: "eligible", snapshot: null },
  ],
};

console.log(JSON.stringify({
  warning: "All offers, counts, policies, prices and costs here are synthetic. This is not the SciFact measurement, real adoption, or a selected commercial policy.",
  assessment: assess(input),
}, null, 2));
