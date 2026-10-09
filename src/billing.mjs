import { assess } from "./assessment.mjs";

function ref(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
}
function amount(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
}
function finite(value) {
  if (!Number.isFinite(value)) throw new RangeError("Billing arithmetic overflow");
  return value;
}
function pending(reason) { return { status: "needs_check", totalAccessCost: null, perCaseAccessCost: null, reasons: [reason] }; }

export function priceBillingPlan(workload, plan) {
  for (const key of ["workloadRef", "horizonRef", "billingMeterRef"]) ref(workload[key], key);
  if (!Number.isSafeInteger(workload.taskCount) || workload.taskCount < 1) throw new RangeError("taskCount must be a positive safe integer");
  amount(workload.usageUnits, "usageUnits");
  if (!["incremental", "acquisition"].includes(workload.costBasis)) throw new TypeError("Unknown cost basis");
  if (!plan) return pending("missing_billing_plan");
  for (const key of ["planRef", "currency", "horizonRef", "billingMeterRef"]) ref(plan[key], key);
  if (plan.horizonRef !== workload.horizonRef) return pending("mismatched_billing_horizon");
  if (plan.billingMeterRef !== workload.billingMeterRef) return pending("mismatched_billing_meter");
  if (!["pay_as_you_go", "subscription"].includes(plan.billingModel)) throw new TypeError("Unsupported billing model");
  for (const key of ["unitPrice", "setupCost", "quotaOpportunityCost"]) {
    if (plan[key] === null || plan[key] === undefined) return pending(`missing_${key}`);
    amount(plan[key], key);
  }
  if (typeof plan.overageAllowed !== "boolean") throw new TypeError("overageAllowed must be explicit");
  let fixedFeeApplied = 0;
  let allowanceAvailable = 0;
  let entitlementSnapshotRef = null;
  if (plan.billingModel === "subscription") {
    if (!["existing", "new"].includes(plan.access)) throw new TypeError("Subscription access must be existing or new");
    if (plan.access === "existing") {
      if (workload.costBasis !== "incremental") return pending("renewal_requires_new_plan_quote");
      const e = plan.entitlementSnapshot;
      if (!e) return pending("missing_entitlement_snapshot");
      for (const key of ["planRef", "horizonRef", "billingMeterRef"]) {
        if (e[key] !== plan[key]) return pending(`mismatched_entitlement_${key}`);
      }
      if (e.authorized !== true || e.coverageConfirmed !== true) return pending("entitlement_not_confirmed");
      ref(e.snapshotRef, "entitlement snapshotRef");
      if (e.remainingUnits === null || e.remainingUnits === undefined) return pending("missing_remaining_allowance");
      if (e.reservedUnits === null || e.reservedUnits === undefined) return pending("missing_reserved_allowance");
      amount(e.remainingUnits, "remainingUnits");
      amount(e.reservedUnits, "reservedUnits");
      if (e.reservedUnits > e.remainingUnits) throw new RangeError("Reserved allowance exceeds remaining allowance");
      allowanceAvailable = e.remainingUnits - e.reservedUnits;
      entitlementSnapshotRef = e.snapshotRef;
    } else {
      for (const key of ["fixedFee", "includedUnits"]) {
        if (plan[key] === null || plan[key] === undefined) return pending(`missing_${key}`);
        amount(plan[key], key);
      }
      fixedFeeApplied = plan.fixedFee;
      allowanceAvailable = plan.includedUnits;
    }
  }
  const billedUnits = Math.max(0, workload.usageUnits - allowanceAvailable);
  if (billedUnits > 0 && !plan.overageAllowed) {
    return { status: "ineligible", totalAccessCost: null, perCaseAccessCost: null, reasons: ["allowance_exceeded_overage_disabled"] };
  }
  const usageCharge = finite(billedUnits * plan.unitPrice);
  const totalAccessCost = finite(fixedFeeApplied + usageCharge + plan.setupCost + plan.quotaOpportunityCost);
  return {
    status: "priced", planRef: plan.planRef, billingModel: plan.billingModel,
    currency: plan.currency, workloadRef: workload.workloadRef, horizonRef: workload.horizonRef,
    costBasis: workload.costBasis, billingMeterRef: workload.billingMeterRef,
    taskCount: workload.taskCount, usageUnits: workload.usageUnits,
    fixedFeeApplied, allowanceAvailable, billedUnits, usageCharge,
    setupCost: plan.setupCost, quotaOpportunityCost: plan.quotaOpportunityCost,
    entitlementSnapshotRef, totalAccessCost, perCaseAccessCost: totalAccessCost / workload.taskCount,
    allocationMethod: "workload_average", reasons: [],
  };
}

// Plans and entitlement flags must come from admitted server-side configuration.
// This function forecasts spending; it neither authenticates entitlements nor purchases access.
export function assessBillingPlans({ workload, offers, ...assessment }) {
  if (!Array.isArray(offers)) throw new TypeError("offers must be an array");
  const billing = offers.map((offer) => priceBillingPlan(workload, offer.billingPlan));
  const normalized = offers.map((offer, index) => {
    const priced = billing[index];
    if (offer.eligibility !== "eligible") return { ...offer };
    if (priced.status !== "priced") return { ...offer, eligibility: priced.status === "ineligible" ? "ineligible" : "needs_check" };
    const buyer = offer.buyerCosts;
    if (buyer && buyer.currency !== priced.currency) throw new TypeError("Billing and buyer currencies must match");
    if (offer.operatorCosts && offer.operatorCosts.currency !== priced.currency) throw new TypeError("Billing and operator currencies must match");
    if (buyer?.attemptOverhead === null || buyer?.attemptOverhead === undefined) return { ...offer };
    amount(buyer.attemptOverhead, "base attemptOverhead");
    return { ...offer, buyerCosts: {
      ...buyer,
      attemptOverhead: finite(buyer.attemptOverhead + priced.perCaseAccessCost),
    } };
  });
  const result = assess({ ...assessment, offers: normalized });
  return {
    ...result,
    workload: { ...workload },
    results: result.results.map((item, index) => ({
      ...item, billing: billing[index],
      reasons: [...new Set([...item.reasons, ...billing[index].reasons])],
    })),
  };
}
