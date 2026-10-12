import { assessBillingPlans } from "./billing.mjs";
import { assess } from "./assessment.mjs";
import { RETRIEVAL_OFFERS } from "./retrieval.mjs";
import { SCIFACT_PROFILE, BENCHMARK_CONTEXT } from "./scifact.mjs";
import { BUYER_ALTERNATIVES, DEMO_TERMS, OPERATOR_COST_SNAPSHOT } from "./terms.mjs";

export const ILLUSTRATIVE_SCENARIO = "illustrative-workload-cost/v1";
export const DEMO_TERMS_SCENARIOS = Object.freeze(Object.fromEntries(Object.entries(BUYER_ALTERNATIVES).map(([ref, alternative]) => [`demo-terms-${ref}`, alternative])));
export const ASSESSMENT_SCENARIOS = Object.freeze(["public-evidence", ILLUSTRATIVE_SCENARIO, ...Object.keys(DEMO_TERMS_SCENARIOS)]);
const usdc = units => Number(units) / 1000000;
const policy = Object.freeze({ policyRef: "illustrative-uniform-prior/v1", alpha: 1, beta: 1,
  coverage: 0.95, minimumCases: 30, maximumAgeSeconds: 2592000 });
const workload = Object.freeze({ workloadRef: "illustrative-100-retrievals/v1", horizonRef: "illustrative-period/v1",
  billingMeterRef: "retrieval_requests", taskCount: 100, usageUnits: 100, costBasis: "incremental" });

// This directory is deliberately restricted to public benchmark data. A private
// deployment needs authenticated principal and evidence-store admission first.
export function createPublicDirectory({ report, index, data, asOf = () => Math.floor(Date.now() / 1000) }) {
  if (index.principalRef !== SCIFACT_PROFILE.principalRef || index.sourceVersion !== SCIFACT_PROFILE.corpusSha256) throw new TypeError("Not the public benchmark index");
  const measured = offerRef => report.offers.find(o => o.offerRef === offerRef);
  const visibleDocuments = new Map((data.documents ?? []).filter(doc =>
    doc.authorizedPrincipals.includes(SCIFACT_PROFILE.principalRef)
    && doc.sourceVersion === SCIFACT_PROFILE.corpusSha256).map(doc => [doc.id, doc]));
  function requireProfile(profileRef) {
    if (profileRef !== SCIFACT_PROFILE.profileRef) throw new TypeError("Unsupported public benchmark profile");
  }
  function requireOffer(offerRef) {
    if (!RETRIEVAL_OFFERS.some(o => o.offerRef === offerRef)) throw new TypeError("Unknown retrieval offer");
  }
  return {
    listOffers() {
      return { scope: "public-benchmark-demo", profileRef: SCIFACT_PROFILE.profileRef,
        assetClass: "authorized_source_retrieval", fundable: false,
        offers: RETRIEVAL_OFFERS.map(offer => ({ ...offer, outputLimit: 5,
          sourceVersion: SCIFACT_PROFILE.corpusSha256, productionPrice: null,
          observedHitRate: measured(offer.offerRef).observedHitRate, measuredCases: report.queryCases })) };
    },
    assess({ profileRef, scenarioRef = "public-evidence" }) {
      requireProfile(profileRef);
      if (!ASSESSMENT_SCENARIOS.includes(scenarioRef)) throw new TypeError("Unknown assessment scenario");
      const illustrative = scenarioRef === ILLUSTRATIVE_SCENARIO;
      const alternative = Object.hasOwn(DEMO_TERMS_SCENARIOS, scenarioRef) ? DEMO_TERMS_SCENARIOS[scenarioRef] : null;
      const offers = RETRIEVAL_OFFERS.map((offer, i) => {
        const m = measured(offer.offerRef);
        const item = { offerRef: offer.offerRef, eligibility: "eligible", snapshot: {
          ...BENCHMARK_CONTEXT, offerRef: offer.offerRef, policyRef: policy.policyRef,
          snapshotRef: `paired-public-benchmark/${report.codeSha256["src/retrieval.mjs"]}`,
          successes: m.representativeSuccesses, failures: m.representativeFailures,
          unresolved: 0, complete: true, independentUnits: scenarioRef !== "public-evidence", observedAt: report.observedAt,
        } };
        // Agreed USDC terms: consumed charges are paid on every attempt, principal only on success.
        if (alternative) {
          item.buyerCosts = { currency: "USDC", assumptionRef: scenarioRef, purchasePrice: usdc(DEMO_TERMS.principal),
            attemptOverhead: usdc(DEMO_TERMS.executionCharge) + usdc(DEMO_TERMS.evaluationCharge), failureRetention: 0,
            fallbackOnFailure: alternative.costPerQuery, lossOnFailure: 0, directCost: alternative.costPerQuery };
          item.operatorCosts = { currency: "USDC", termsRef: DEMO_TERMS.termsRef, successShare: 0, earnedServiceFees: usdc(DEMO_TERMS.executionCharge),
            deliveryCost: OPERATOR_COST_SNAPSHOT.deliveryCostPerAttempt, subsidy: 0, evidenceCost: 0, expectedPaidAttempts: 1, minimumContribution: 0 };
        }
        if (illustrative) {
          item.buyerCosts = { currency: "DEMO_UNITS", assumptionRef: ILLUSTRATIVE_SCENARIO,
            attemptOverhead: 0.02, purchasePrice: 0, failureRetention: 0, fallbackOnFailure: 1, lossOnFailure: 0, directCost: 1 };
          item.operatorCosts = { currency: "DEMO_UNITS", termsRef: ILLUSTRATIVE_SCENARIO,
            successShare: 0, earnedServiceFees: 0.02, deliveryCost: 0.01, subsidy: 0,
            evidenceCost: 0, expectedPaidAttempts: 100, minimumContribution: 0 };
          item.billingPlan = { planRef: `illustrative-plan/${i}`, horizonRef: workload.horizonRef,
            billingMeterRef: workload.billingMeterRef, currency: "DEMO_UNITS", setupCost: 0,
            quotaOpportunityCost: 0, overageAllowed: true, unitPrice: 0.002,
            ...(i === 0 ? { billingModel: "pay_as_you_go" } : { billingModel: "subscription",
              access: "new", fixedFee: 0.3, includedUnits: 100 }) };
        }
        return item;
      });
      const input = { context: BENCHMARK_CONTEXT, policy, asOf: asOf(), offers };
      const assessed = illustrative ? assessBillingPlans({ ...input, workload }) : assess(input);
      return { ...assessed, scenarioRef, fundable: false,
        evidenceScope: "Public SciFact relevance. Not enterprise acceptance or arbitrary-query success.",
        assumptions: alternative ? ["Representative cases treated as independent for this conditional demonstration.",
          `Agreed USDC terms ${DEMO_TERMS.termsRef}; buyer alternative ${scenarioRef.slice("demo-terms-".length)}: ${alternative.basis}.`]
          : illustrative ? ["Representative cases treated as independent for this conditional demonstration.",
          "Uniform prior, costs, tariffs, workload and operator terms are illustrative, not selected commercial policy."] : [],
        calibrationStatus: "not_established", independenceStatus: "not_established",
        results: assessed.results.map(({ contribution, ...result }) => ({ ...result,
          observedHitRate: measured(result.offerRef).observedHitRate, measuredCases: report.queryCases,
          localMeanQueryMs: measured(result.offerRef).localMeanQueryMs,
          localP95QueryMs: measured(result.offerRef).localP95QueryMs,
          latencyScope: report.run.latencyScope })),
      };
    },
    retrieve({ offerRef, query }) {
      requireOffer(offerRef);
      return { offerRef, sources: index.search({ offerRef, query, requestingPrincipal: SCIFACT_PROFILE.principalRef,
        requiredSourceVersion: SCIFACT_PROFILE.corpusSha256 }),
      pOutcome: null, reason: "No admitted arbitrary-query success forecast", fundable: false };
    },
    readSource({ sourceRef, offset = 0 }) {
      const doc = visibleDocuments.get(sourceRef);
      if (!doc) throw new TypeError("Source unavailable");
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > doc.text.length) throw new RangeError("Invalid source offset");
      return { sourceRef, sourceVersion: doc.sourceVersion, location: doc.location,
        title: doc.title.slice(0, 512), excerpt: doc.text.slice(offset, offset + 1000), offset,
        nextOffset: offset + 1000 < doc.text.length ? offset + 1000 : null,
        scope: "Public benchmark source content, not a generated answer", license: "CC BY-SA 4.0" };
    },
    runBenchmarkCase({ offerRef, caseRef }) {
      requireOffer(offerRef);
      if (!data.gold.has(caseRef)) throw new TypeError("Unknown public benchmark case");
      const sources = index.search({ offerRef, query: data.queries.get(caseRef), requestingPrincipal: SCIFACT_PROFILE.principalRef,
        requiredSourceVersion: SCIFACT_PROFILE.corpusSha256, excludeSourceRef: caseRef });
      return { offerRef, caseRef, profileRef: SCIFACT_PROFILE.profileRef, sources,
        observedSuccess: sources.some(s => data.gold.get(caseRef).has(s.sourceRef)),
        repeatCountsAsNewEvidence: false, fundable: false };
    },
  };
}
