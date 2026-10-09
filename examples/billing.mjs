import { priceBillingPlan } from "../src/billing.mjs";

const common = {
  horizonRef: "synthetic-period/v1", billingMeterRef: "retrieval_requests",
  currency: "DEMO_UNITS", setupCost: 0, quotaOpportunityCost: 0,
  overageAllowed: true,
};
const plans = [
  { ...common, planRef: "synthetic-payg/v1", billingModel: "pay_as_you_go", unitPrice: 0.2 },
  { ...common, planRef: "synthetic-new-plan/v1", billingModel: "subscription",
    access: "new", fixedFee: 10, includedUnits: 100, unitPrice: 0.2 },
  { ...common, planRef: "synthetic-owned-plan/v1", billingModel: "subscription",
    access: "existing", unitPrice: 0.2, entitlementSnapshot: {
      planRef: "synthetic-owned-plan/v1", horizonRef: common.horizonRef,
      billingMeterRef: common.billingMeterRef, snapshotRef: "synthetic-entitlement/v1",
      authorized: true, coverageConfirmed: true, remainingUnits: 100, reservedUnits: 20,
    } },
];
console.log(JSON.stringify({
  warning: "Synthetic tariffs and workloads. Workload averages are forecasts, not next-request charges, market prices, or spending permission.",
  scenarios: [10, 100, 150].map(taskCount => {
    const workload = {
      workloadRef: `synthetic-workload/${taskCount}`, horizonRef: common.horizonRef,
      billingMeterRef: common.billingMeterRef, taskCount, usageUnits: taskCount,
      costBasis: "incremental",
    };
    return { workload, plans: plans.map(plan => priceBillingPlan(workload, plan)) };
  }),
}, null, 2));
