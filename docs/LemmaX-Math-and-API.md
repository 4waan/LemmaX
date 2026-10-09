# LemmaX: decision mathematics and assessment API

**Confirmed MVP boundary:** a resource directory with deterministic equations and structured assessment outputs. LemmaX returns `P_outcome`, ranks eligible resources by `C_reuse`, and governs its service offers through contribution margin. It does not generate an integration plan or perform agentic adoption work in the initial assessment path.

**Status:** proposed mathematical and API contract for review. No production prices, priors, evidence thresholds, probability calibration claims, margin floors, subscriptions, refund deductions, or implementation are selected by the numerical examples. This specification takes precedence over earlier adoption-plan proposals for the MVP.

The user's pasted directory proposal is the baseline. The broader [LemmaX architecture](LemmaX-Architecture.md) continues to define private records, approved evaluators, commitments, and settlement. Optional agent investigation remains a separately scoped future service, not a dependency of the directory query.

## 1. Shared outcome definition

For asset release `a` and an explicitly supplied context `x`, define:

```text
Y(a, x) = 1 when the agreed outcome specification passes
          within the fixed effort allowance and deadline
Y(a, x) = 0 when an eligible, resolved attempt fails that target
P_outcome(a, x) = Pr(Y(a, x) = 1 | comparable authorized evidence)
```

The outcome specification names the task, required inputs and outputs, acceptance predicates, target environment class, effort/metering limits, deadline, disclosure policy, and evaluator method. It has an immutable identity and version. Sensitive test bodies remain within the company boundary.

The agreed granularity distinguishes the underlying asset, its versioned commercial capability offer, and a bounded task case as the measurement unit. Versioned benchmark batches evaluate those cases consistently. The outcome specification declares whether its evidence concerns benchmark-case success or company acceptance. For a multi-capability model, connector, or MCP server, the assessment must identify which capability and deployment/adapter are being evaluated. Relevant model settings and provider conditions belong in the context. The user confirms that the directory should cover both hosted inference access and downloadable weights/adapters. The first capability and demonstrated execution paths remain open; no global asset-wide success probability is implied.

Across those delivery forms, compare the same outcome requirements, applicable company constraints, and planned workload horizon. Each deployment retains its own admissible outcome evidence. Include hosted usage charges or local setup and hardware/runtime expenditure as applicable, without counting any item twice. A per-call price and a one-time license cannot establish relative completion cost without a workload assumption. Model task quality, connector compatibility, and full acceptance success must be labeled distinctly in evidence; an observation of one cannot silently serve as an observation of another.

**Assets are comparable only against the same outcome specification and applicable context.** Their native functions can differ, but the completion target and quality requirements must agree. A successful import for one resource cannot be compared with a passed integration test for another. Asset-specific adapters may implement the common acceptance boundary; their versions belong in the evidence context.

The API validates manifest identity, runtime/interface constraints, permissions, license requirements, and evidence applicability before forecasting. A blocked candidate is `ineligible`; an unknown requirement is `needs_check`. Neither receives a fabricated probability of zero or one.

The company's agent supplies its intended integration strategy as part of the context, or chooses a published strategy profile. LemmaX does not invent that strategy. Checks measure applicability; they are not additional successful adoption observations.

An evaluator distinguishes completed failure, policy-defined timeout, unresolved evidence, and disputed observations. Missing telemetry alone is not an observed failure. The sample-admission policy must specify how these states are handled before counters are updated.

## 2. P_outcome: comparable outcome statistics

Use a versioned cohort rule over exact release and adapter, common outcome specification, relevant environment, supplied strategy, adopter/configuration class, effort budget, and accepted evidence method. Return the rule identity and snapshot with the result.

For `s` comparable successes and `f` comparable resolved failures, the proposed initial model is:

```text
prior:       p ~ Beta(alpha, beta)
posterior:   p | observations ~ Beta(alpha + s, beta + f)
point mean:  p_mean = (alpha + s) / (alpha + beta + s + f)
```

This follows a Bernoulli likelihood with an explicitly disclosed Beta prior. The standard Beta distribution has mean `a/(a+b)`; interval endpoints are numerical quantiles of that distribution. [NIST Beta distribution](https://www.itl.nist.gov/div898/handbook/eda/section3/eda366h.htm).

For a requested posterior coverage `h`, return:

```text
p_low  = BetaQuantile((1-h)/2, alpha+s, beta+f)
p_high = BetaQuantile((1+h)/2, alpha+s, beta+f)
```

This is a Bayesian credible interval under the chosen model. It is not a frequentist confidence interval, nor a guarantee that the forecast is calibrated for future companies. Wilson proportion intervals are an alternative presentation if selected; do not silently mix the two interpretations. [NIST proportion intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).

Return mean, interval method/coverage, prior, eligible successes/failures, unresolved count, evidence freshness, cohort policy, and calibration status. Publish counts only under the authorized disclosure policy.

Repeated attempts from the same company or agent can be correlated. The observation-unit and duplicate/cluster policy must be explicit; raw retry counts cannot be treated as independent trials. Simple Beta updating assumes comparable, sufficiently independent units. Biased reporting and context drift are outside the interval's protection.

If applicable evidence is insufficient, return `insufficient_evidence` with `mean: null` and `interval: null`. A prior-only diagnostic can be labeled separately; it cannot make a candidate empirically rankable. Minimum evidence and freshness rules remain open policy settings.

No custom neural-network training is required. Reliable probability estimates still require real comparable observations. A four-day demo must label synthetic examples and reference-harness outcomes accurately rather than presenting them as company adoption history.

### Per-resource probability comparison

The directory can show one probability bar for each comparable offer: `p_i = Pr(case passes | offer_i, declared profile, admitted evidence)`. All bars use the same acceptance target, applicable context, and probability scale. Values such as `0.84`, `0.05`, and `0.11` are illustrations supplied in conversation, not measured resource estimates.

These are separate success events. Multiple offers can pass or fail the same case, so the bars need not sum to one. Do not normalize success probabilities across offers. A normalized score is not automatically a calibrated outcome probability.

Each real bar carries the interval method/coverage, admissible evidence count, profile/offer version, snapshot age, and calibration status. Insufficient evidence is shown as unknown, rather than a fabricated small probability. Under the proposed Beta estimator, the point mean is `(alpha+s)/(alpha+beta+s+f)`; the prior and observation scope are disclosed. No estimator defaults have been selected here.

The default ordering remains expected completion cost `C_reuse`; the probability chart helps explain the tradeoff. A separate probability that an offer is the best choice would need a definition of best, a joint uncertainty model including shared-case dependence, and an explicit tie policy. Such a winner distribution is a different output and is outside the initial chart proposal.

The [business and benchmark research](LemmaX-Business-Requirements.md) separates `capability_benchmark`, `deployment_conformance`, and `acceptance_attempt` evidence. Store the observation unit, dataset/record version, evaluation configuration, and outcome-policy reference with each. Benchmark query hits must not silently update company acceptance counters. A policy that accepts a whole benchmark batch has one batch-level verdict; its individual query metrics are supporting measurements. The executed SciFact baseline therefore leaves company-adoption `pOutcome` as `insufficient_evidence`.

### Proposed MVP evidence-admission policy

This is the next policy for review. It defines which measurements may support a probability, without choosing estimator defaults or a minimum sample threshold.

1. **Start with a reproducible benchmark cohort.** Freeze the licensed dataset/version, case manifest, ground-truth references, acceptance predicates, and execution context before evaluating comparable offers. The probability is labeled with that benchmark scope. The accepted initial retrieval quality predicate is at least one labeled relevant source among up to five authorized references, with provenance. Exact cost/deadline limits and candidate offers remain open.
2. **Match exact versions and context.** A case must match the offer/model, connector/adapter, relevant runtime configuration, outcome profile, and benchmark version. Hosted and company-run execution retain distinct contexts. A version change starts new evidence applicability checks; do not silently inherit its predecessor's counts.
3. **Use an approved evaluator and complete reporting.** The evaluator checks outputs against frozen ground truth and records measured costs/timing where required. Preserve every scheduled case, including failures, policy-defined timeouts, abstentions, and unresolved observations. A batch with unresolved scheduled outcomes is incomplete for its official comparison; do not publish a success-only subset as its probability. Signatures bind the issuer and record versions, not the honesty of execution. Vendor claims alone are supporting metadata until the evidence policy admits them.
4. **Prevent count inflation.** The declared retry budget belongs inside one case: all consumed effort is counted and the case receives one resolved result. Replaying or repeatedly evaluating the same case does not create additional independent task examples. Known correlated groups require an explicit cluster policy before a Beta interval is presented. A simple first policy can preselect one representative per identified group before outcomes are known, with the resulting sampling profile disclosed. If independence remains unsupported, return descriptive benchmark measurements and flag the interval/forecast as unavailable under the simple model.
5. **Keep company evidence separate and authorized.** A company's private workload can produce a private, context-specific estimate. Global pooling and disclosure need explicit authorization and applicability rules. Public benchmark cases cannot stand in for company adoption history. Detailed records remain offchain within the approved access boundary.
6. **Publish provenance and gaps.** Return evidence kind, case-manifest/profile versions, cohort policy, snapshot age, admitted successes/failures, unresolved and excluded counts, evaluator identity where permitted, and contamination/domain limitations. Unknown labels, missing required cost/timing checks, or incompatible context cannot be converted into passing evidence. Model-reported confidence is not an additional observed success.

Recommendation for the four-day demo: derive the initial chart from reproducible evaluated benchmark cases; offer company-specific estimates only when admissible authorized company evidence exists. Publish no fabricated company-success bars. Admission can be implemented with schemas, deterministic checks, deduplication, and an evaluator receipt. No learned evidence-classification layer is required.

## 3. C_reuse: expected completion cost

The general buyer model is:

```text
C_reuse = E[P_retained + W + (T-S) + G + D
            + indicator(Y=0) * (B_failure + L)]
```

`W` is buyer-owned integration expenditure; `T-S` is the net service bill; `G` is buyer-paid chain expenditure, including settlement; and `D` is an optional company-supplied monetary value for delay or locked capital. Costs must be in the same currency and must not overlap. Model calls already included in `T` cannot also appear in `W`.

Optional evidence publication follows the same accounting. A buyer's directly paid publication transaction belongs in `G`; a publication service billed by LemmaX belongs in `T`. Count the expense once. A cost absorbed by LemmaX belongs in its internal operating-cost term, without automatically increasing the buyer's bill. Storage provenance does not independently increase `P_outcome`. The [blob research](LemmaX-Blob-Research.md) describes this proposed extension; no blob dependency is selected for the MVP.

Let `A = E[W + (T-S) + G + D]`. If the full purchase price `P` is retained on success, and `R_failure` is the expected purchase amount retained conditional on failure:

```text
C_reuse = A + p*P + (1-p)*(R_failure + B_failure + L)
```

`R_failure`, `B_failure`, and `L` are conditional failure expectations in the same model. This expression does not assume that purchase retention and fallback costs are independent of the outcome.

Under full principal refund for every failed attempt, with the same fallback cost `B` before and after failure:

```text
C_reuse = A + p*P + (1-p)*(B+L)
expected_saving = B - C_reuse
```

If only some failures qualify for a full refund, `R_failure = (1-q)*P`, where `q` is the conditional probability of refund eligibility. Partial refunds require the actual expected retained amount. Unknown refund eligibility must be returned as a missing assumption rather than replaced with a full-refund promise.

The agreed per-attempt policy refunds full connector principal on eligible failure, retains only actual separately quoted execution/evaluation charges within accepted caps, and returns unused reserve to the buyer's available credit. A cohort restricted to eligible failures has `R_failure = 0`. A broader failure population must model its actual eligibility mix. Consumed service charges remain in `A`; unused reserve is not a consumed charge. Withdrawal fees or delay/locked-capital costs belong in `G` or `D` once, under the selected withdrawal policy.

Direct completion cost `B_direct` can differ from `B_failure`, since a failed attempt may leave useful work or introduce recovery costs. In that case compare `B_direct - C_reuse`, not an automatically reused `B`.

### Ranking and uncertainty

Rank eligible, adequately evidenced, available candidates by ascending expected `C_reuse` for the same target. Return direct completion as an explicit alternative. Buyer policy may require a saving allowance `delta`:

```text
reuse meets point-estimate policy when C_reuse + delta < B_direct
```

Unknown probabilities or material costs receive `rank: null`. Preserve these candidates with missing-input reasons; do not force them to the bottom of a numerical ranking as though their cost were known.

For fixed cost assumptions, propagate the probability interval by evaluating both endpoints:

```text
cost_low  = min(C_reuse(p_low), C_reuse(p_high))
cost_high = max(C_reuse(p_low), C_reuse(p_high))
```

The direction depends on whether successful purchase cost is above or below failed-attempt retention plus fallback and loss. A lower probability is not universally the higher-cost case. This range reflects probability uncertainty only; uncertain expenditure and fallback need separately labeled scenarios or a joint model.

The forecast is not a spending authorization or a settlement verdict. Actual payments use frozen quotes and integer atomic-unit accounting.

### Subscription and usage billing

Billing plans are separate from capability and interface definitions. Subscription access is within the requested directory scope. Compare plans over one declared workload and horizon; a recurring access fee cannot be treated as a per-call purchase price or multiplied by a per-case success probability.

For a simple fixed-fee plan with included allowance and linear overage, define:

```text
C_subscription(H) = F_incremental(H)
                  + o * max(0, usageUnits(H) - Q_available(H))
                  + O_quota(H) + I_setup(H)
                  + sum_i E[W_i + (T_i-S_i) + P_retained_i
                            + indicator(Y_i=0)*(B_i+L_i)]
                  + G_H + D_H
average_case_cost = C_subscription(H) / N_H
```

`H` is the shared workload horizon, `N_H` its task count, and usage units use the plan's actual meter. `Q_available` excludes allowance already spent or reserved for other work. `o` is the overage tariff under the verified terms; unsupported overage is an eligibility limit, not permission to spend. `O_quota` is a declared opportunity cost for displacing other planned uses. `I_setup` is one-time setup expenditure. The per-case sum excludes expenses already counted in the plan, setup, chain or delay terms.

For a current, already-paid plan, `F_incremental = 0` if this decision creates no upgrade, extra seat, renewal or other additional fixed charge. Report that as an incremental spending comparison. For acquisition or renewal planning, include the actual additional recurring fee over the same horizon. A fully allocated cost view may attribute sunk subscription expense, but it must be labeled separately and must not control the incremental choice by silently charging it twice.

Already-covered access normally has no new per-case access principal: `P_retained_i = 0` for that right. Additional connector services can have their own explicit charges. A plan-level cancellation or service credit follows its own terms; there is no automatic refund of a whole subscription when one query fails.

The simple workload allocation model is implemented in `src/billing.mjs`. Flat-rate, seat, tiered, usage and credit-based subscriptions require their actual constraints and tariff functions. [Stripe recurring pricing models](https://docs.stripe.com/products-prices/pricing-models). As a concrete model-service example, Hugging Face applies included compute credits on its routed billing path, while a custom provider key is billed by the provider and does not use those credits. Verify the actual route and entitlement before treating an allowance as available. [Hugging Face billing](https://huggingface.co/docs/inference-providers/pricing).

Proposed assessment additions are `billingModel`, `billingPlanRef`, `entitlementSnapshotRef`, `costBasis`, `workloadRef`, `horizonRef`, forecast task/usage quantities, remaining allowance, and fee/overage constraints. The local `priceBillingPlan` and `assessBillingPlans` exports implement a subset of these fields, described in [the implemented contract](Implementation.md). HTTP/MCP transport remains proposed. The adapter consumes admitted entitlement snapshots; it does not verify live subscription rights, reserve quota or enforce provider rate limits.

Ways to lower measured completion cost are to use authorized existing entitlement where it fits the task, avoid unnecessary new subscriptions, consume appropriately allocated included allowance before overage, share cached evaluation/indexing work only within authorized boundaries, and batch small onchain withdrawals. Each depends on terms, quality, freshness, quota and actual cost measurements. Neither a subscription nor a high utilization forecast guarantees a lower cost.

## 4. Contribution margin: governing LemmaX services

The supplied marketplace contribution equation is retained:

```text
m = p*tau*P + F - C - S - K/N
```

- `tau` is LemmaX's share of a successful purchase, if that fee model is selected.
- `F` is expected service-fee revenue earned by LemmaX before its subsidy credits and before the expenses counted in `C`.
- `C` is expected attributable delivery, execution, verification, settlement, and support expense borne by LemmaX.
- `S` is expected LemmaX-funded subsidy that reduces the customer's service bill or is paid out by LemmaX.
- `K/N` allocates evidence creation/refresh cost over expected paid attempts before that evidence becomes stale.

All expectation terms refer to the same attempt population and horizon. `C` excludes evidence expense already counted in `K/N`. If `F` is measured after subsidy, subtracting `S` again would double count it. Company-owned compute is a buyer cost, not automatically a LemmaX expense.

Purchase principal held for a publisher is a liability. A returned escrow reserve is not revenue or a fresh expense. Only the marketplace share earned under the actual policy belongs in `p*tau*P`.

The probability event must match the event that earns the purchase share. A per-query benchmark success rate is not a whole-batch, integration-acceptance, or license-purchase probability. The [readiness review](LemmaX-Build-Readiness-and-Reuse.md#1-match-the-paid-unit-to-the-measured-outcome) proposes a one-case service attempt for the demo, with its reference population disclosed; unrelated company contexts still require their own admissible evidence or an unknown forecast.

For another revenue policy, use the general form:

```text
m = E[R_LemmaX + F_attempt - C_attempt - S_attempt] - K/N
```

`R_LemmaX` is the purchase revenue actually earned by LemmaX under that policy. No success fee percentage, margin floor, or evidence reuse count has been selected.

For a LemmaX subscription, use a period-level contribution model:

```text
M_H = R_subscription_earned(H)
    + sum_i E[R_attempt_i + F_extra_i - C_i - S_i]
    - K_H - C_period_direct(H)
```

`R_subscription_earned` is LemmaX's own earned plan revenue or earned subscription commission, rather than the entire provider invoice owed to someone else. `F_extra_i` includes only fees charged in addition to the subscription; included evaluations cannot also be counted as new per-case revenue. Evidence expense and directly attributable period expense are counted once. Use actual plan refund/credit terms when deriving earned revenue. Do not multiply the recurring subscription fee by per-query `p` or assume every subscribed task produces a new marketplace commission.

A proposed economical LemmaX plan includes cached assessments and a bounded evaluation allowance, with transparent additional execution/evaluation charges and optional overage. Batch evidence refresh and settlement where useful, while preserving per-case outcomes and private access controls. Plan prices, allowances and discounts are unselected; unlimited costly execution is not assumed.

### Service availability and subsidy limits

Given an explicitly configured minimum contribution `m_min`, define the pre-subsidy contribution:

```text
m_before_subsidy = p*tau*P + F - C - K/N
```

If it is below `m_min`, the service offer does not pass that commercial gate without a separately authorized loss allowance. Setting subsidy to zero does not repair an already negative contribution.

Otherwise, a proposed maximum subsidy is bounded by:

```text
S <= min(gross eligible service bill,
         remaining subsidy reserve,
         competence-policy subsidy cap,
         m_before_subsidy - m_min)
```

Competence changes the subsidy cap, not the unit tariff. A query may estimate a subsidy; an executable quote must reserve and freeze the actual authorized allowance before funding.

Contribution determines what services LemmaX can offer sustainably. It does not replace the buyer's cost ordering or permit changing a probability to favor a larger commission. Operator cost and margin data are internal by default.

### Directory preview affordability

For one possible paid attempt per preview, let `x` be conversion probability and `m_paid` the average paid-attempt contribution for that population:

```text
expected preview cost < x * m_paid
```

If a preview can cause multiple paid attempts, use expected paid attempts per preview instead of a conversion fraction. This contribution bound excludes subscription funding and fixed overhead. The full business must account for those separately.

Free cached discovery, subscription access, metered trials, successful-purchase fees, and optional agent investigation remain possible pricing boundaries. The pasted proposal does not select all of them or any rate.

## 5. Deterministic API boundary

**Proposed minimal query:** `POST /v1/assessments`, exposed through HTTP and an MCP tool such as `lemma_assess` using the same library and schemas. No model call is needed for retrieval, eligibility rules, probability arithmetic, expected-cost ranking, or contribution calculation.

The query accepts:

- A versioned common `outcomeSpecRef`.
- An approved context profile, supplied strategy profile, effort limit, and deadline.
- Exact candidate release/offer references.
- Buyer-owned cost estimates and their provenance.
- Requested interval coverage and buyer ranking policy.

The engine retrieves applicable authorized outcome evidence, immutable prices, estimator policy, service tariffs, and subsidy eligibility. Callers cannot invent trusted outcome counts or edit operator expense inputs to obtain a subsidy. Buyer cost estimates may be caller-supplied, but are labeled as such.

The result returns an eligibility status for every candidate, `pOutcome`, `cReuse`, expected saving, rank, service availability, reasons, assumptions, and snapshot/policy versions. Every ranked candidate carries the same outcome and context identity. A stable asset/release identifier breaks exact cost ties without claiming a probability difference.

Supporting benchmark metrics can be returned separately with their evidence kind, observation unit, dataset/version, and limitations. They do not bypass insufficient acceptance evidence or justify an expected-cost rank requiring an unknown `pOutcome`.

### Illustrative request

The following uses invented identifiers and USDC-denominated estimates. It is a schema example, not a live assessment or a selected token deployment.

```json
{
  "outcomeSpecRef": "webhook-acceptance/v1",
  "contextProfileRef": "node-http-company-ci/v1",
  "strategyProfileRef": "company-supplied-adapter/v1",
  "effortLimit": {"profile": "runner-seconds/v1", "maxUnits": "600"},
  "deadlineSeconds": 900,
  "candidateOffers": [{
    "assetId": "webhook-inbox",
    "releaseRef": "webhook-inbox/1.0.0",
    "offerRef": "demo-offer/v1",
    "buyerWorkExpectedCost": "1.300000"
  }],
  "costBasis": {
    "currency": "USDC",
    "directCompletionCost": "20.000000",
    "fallbackAfterFailureCost": "20.000000",
    "additionalFailureLoss": "1.000000",
    "buyerSettlementAndDelayExpectedCost": "0.000000",
    "provenance": "buyer-supplied-demo-estimates"
  },
  "intervalCoverage": 0.90,
  "rankingPolicy": {"mode": "expected_cost", "requiredSaving": "0.000000"}
}
```

### Illustrative response

For illustration only, assume 39 successes and nine failures under a disclosed `Beta(1,1)` prior. The posterior is `Beta(40,10)`, whose mean is 0.8. Assume net service expenditure of 0.70, buyer work of 1.30, price of 5.00, and full failed-principal refund. None of these counts, priors, or charges is measured LemmaX data.

```json
{
  "assessmentVersion": "lemma-assessment/v1",
  "outcomeSpecRef": "webhook-acceptance/v1",
  "contextProfileRef": "node-http-company-ci/v1",
  "evidenceSnapshotRef": "hypothetical-cohort-snapshot/v1",
  "currency": "USDC",
  "results": [{
    "assetId": "webhook-inbox",
    "releaseRef": "webhook-inbox/1.0.0",
    "offerRef": "demo-offer/v1",
    "eligibility": "eligible",
    "pOutcome": {
      "status": "estimated",
      "mean": 0.8,
      "interval": {"method": "beta_equal_tail", "coverage": 0.90,
                   "lower": 0.701366, "upper": 0.884882},
      "prior": {"alpha": 1, "beta": 1},
      "eligibleSuccesses": 39,
      "eligibleFailures": 9,
      "unresolved": 0,
      "cohortPolicyRef": "hypothetical-comparability/v1",
      "calibrationStatus": "not_evaluated",
      "evidenceKind": "hypothetical_example"
    },
    "cReuse": {
      "status": "estimated",
      "mean": "10.200000",
      "probabilityOnlyRange": {"lower": "8.841885", "upper": "11.778151"},
      "components": {
        "expectedAttemptExpenditure": "2.000000",
        "successPurchasePrice": "5.000000",
        "failedPurchaseRetentionExpected": "0.000000",
        "fallbackAfterFailureExpected": "20.000000",
        "additionalFailureLossExpected": "1.000000"
      }
    },
    "expectedSaving": "9.800000",
    "rank": 1,
    "meetsPointEstimateSavingPolicy": true,
    "serviceAvailability": "illustrative_only",
    "forecastOnly": true,
    "assumptions": ["full_failed_principal_refund", "fixed_cost_inputs",
                    "hypothetical_comparable_observations"]
  }],
  "directCompletionAlternative": {"expectedCost": "20.000000"},
  "notRanked": []
}
```

The interval and cost range are rounded for display. Production cost arithmetic must use the full estimator result, with explicit decimal precision and rounding. Monetary forecasts are decimal strings. Financial quotes and settlement amounts use exact integer atomic units with verified token decimals; no forecast response authorizes payment.

### Internal contribution evaluation

**Proposed operator query:** `POST /internal/v1/contributions`, or the same function called internally by the assessment service. It uses trusted fee, expense, evidence-allocation, and subsidy policies. It does not accept public overrides of `tau`, costs, or funded subsidy reserves.

An illustrative calculation for the same price/probability is:

```text
p=0.8; tau=0.10; P=5.00
F=0.80; C=0.30; S=0.10; K/N=0.20
m = 0.8*0.10*5 + 0.80 - 0.30 - 0.10 - 0.20 = 0.60
```

This is consistent with a buyer net service expenditure of `F-S=0.70` in the example. At hypothetical 2% conversion, free-preview cost must be strictly below `0.02*0.60 = 0.012` per preview before fixed overhead. Rates and conversion are illustrative, not forecasts.

Return contribution components, policy version, sensitivity to uncertain inputs, subsidy headroom, and an availability/gate decision. Return `insufficient_cost_basis` instead of assuming zero for unknown expense or infinite evidence reuse.

### Authorized outcome ingestion

**Proposed evidence operation:** `POST /v1/outcomes`, restricted to accepted evaluator authority. It records an attempt-bound signed outcome with outcome/context/release references and evidence-policy provenance. It is not an unrestricted public feedback counter.

Verify authorization, frozen attempt binding, allowed disclosure, terminal outcome, and duplicate handling before updating any cohort. Replays are idempotent. Revoked/disputed evidence must be handled by the versioned evidence policy and snapshot, not silently counted twice. Settlement remains authoritative in the escrow workflow; an HTTP write does not release funds.

Where a company authorizes no detailed egress, this evidence and arithmetic operate locally over company-controlled records. Shared directory statistics require separately authorized aggregates or observations. A service cannot estimate comparable public history from commitments that deliberately hide all cohort information.

## 6. Responses, validation, and implementation scope

Required response statuses include `eligible`, `ineligible`, and `needs_check`; probability states include `estimated` and `insufficient_evidence`; cost states include `estimated` and `insufficient_cost_basis`. Missing values are `null`, with structured reasons. Quote availability is separate from statistical eligibility.

Reject malformed units, negative monetary costs, invalid probability/coverage ranges, contradictory outcome/context versions, and unsupported refund assumptions. Use `400` for malformed requests, `401/403` for unauthorized access, and `422` for contradictory or unsupported semantic inputs. A well-formed query with insufficient evidence returns a structured successful response with no numerical ranking for the affected candidate.

Use one deterministic calculation library in the existing TypeScript service and local bridge. Existing schemas, catalog filtering, PostgreSQL evidence storage, and bounded company-side checks are reuse candidates. No new hosting migration, framework choice, runtime deployment, or paid model integration is selected by this contract.

Cache by all material query inputs plus release/offer, outcome/context, evidence snapshot, estimator, tariff, subsidy, and refund-policy versions. Price expiry and authorization freshness are checked separately. Never reuse a forecast across a materially different outcome merely because the asset name is the same.

For scale readiness, the intended query path reads admitted, versioned cohort statistics rather than replaying every historical case. Evidence evaluation and admission occur separately, with deduplication and authorization. Measure the actual HTTP/MCP path, database work, cache invalidation, response correctness, cost, and overload behavior using the [architecture's minimum scale protocol](LemmaX-Architecture.md#minimum-evidence-of-scale-readiness). This is a design target; no assessment load-test or settlement scale result is available yet.

Verification should include independent state-by-state accounting against the cost formula, success/failure/refund variants, boundary probabilities, unknown evidence, duplicate outcomes, correlated-unit policy, and order changes under different costs. Calibration requires future or held-out real observations; syntactic correctness and passing example arithmetic cannot establish it.

This documentation's illustrative full-refund cost, partial-retention cost, contribution, and preview bound were checked by direct branch accounting with decimal arithmetic. Beta interval endpoints were computed through the integer-shape binomial CDF identity and numerical bisection. No API implementation, application tests, deployment, or empirical calibration was performed.

## 7. Next decision

Define **one shared acceptance outcome for the first asset family**. Specify exactly what observable output or behavior counts as success, within which effort/deadline limits. This is the next product decision because it makes `P_outcome` interpretable and cross-asset `C_reuse` ranking meaningful.

After that, select the sample-admission/evaluator policy, actual refund accounting, and estimator defaults incrementally. The numerical directory scope is settled; these policies are not inferred from the examples.
