# LemmaX paid unit: bounded source-retrieval attempt

Working MVP scope. The user approved proceeding after the one-case recommendation and agreed the principal-refund policy. This document makes that scope implementable; tariffs, withdrawal semantics and numerical limits still require selection.

## What is listed and purchased

The asset class is `authorized_source_retrieval`. A listing identifies one versioned connector capability, including its adapter and model/provider/runtime configuration where applicable. It can be exposed through MCP or equivalent HTTP.

The measurement unit is one bounded attempt against a frozen task and corpus/access profile. Its result contains up to five ranked source references with provenance. The attempt includes the declared retry allowance and its aggregate consumption. A retry is not a new independent benchmark case. Resource access may be billed per use or covered by a subscription; an attempt is not necessarily a fresh purchase of access already paid for.

Each reference needs source/document identity within the private boundary, source version, location sufficient to verify provenance, and rank. Exact excerpt limits and output schema belong in the next offer/interface decision.

The purchase terms must state the service allowance and deliverable rights. The unit does not automatically grant a perpetual connector license, transfer model ownership, or authorize unrestricted corpus access. Hosted and company-run offerings may both implement this capability, with distinct applicable contexts and costs.

## Frozen acceptance boundary

For the initial answerable retrieval cohort, success requires all of:

1. At least one evaluator-labeled relevant source among at most five returned references.
2. Every returned reference is authorized for the requesting principal and preserves verifiable provenance.
3. Required source-version/freshness conditions hold.
4. The entire allowed attempt completes within its quoted deadline and expenditure/consumption allowance.

The relevance predicate is already agreed. Specific time, cost, freshness, excerpt, and retry limits remain open. Do not supply silent defaults. Known unsupported tasks should fail eligibility before funding where possible. Missing labels or telemetry are unresolved evidence, rather than automatic task failures.

Authorization-denied, stale/deleted-source and unsupported-query tests also belong in conformance evaluation. Correct abstention in a denied-access fixture must not be counted as a relevant-source success. A future abstention service can have a different outcome profile.

## Quote and private record

A fundable quote needs exact offer/context/outcome versions, private task/input references, corpus and access snapshot, limits, buyer and payee authorization, evaluator authority, priced service and ancillary charges, refunds, timeout rules, quote expiry, and attempt nonce.

Detailed fields stay private. A randomized commitment binds the record to minimal Monad financial and authorization state. A signature and commitment authenticate bindings; neither proves honest evaluator execution. No fundable quote or settlement contract is implemented in this first library slice.

## Attempt states

```text
draft -> quoted -> funded -> executing -> awaiting_evaluation
awaiting_evaluation -> settled_success
awaiting_evaluation -> settled_failure
```

Failure eligibility and allocation are evaluated under frozen terms. Deadline expiry, unresolved evidence, cancellation and dispute transitions require the next financial policy. Funding remains unavailable until those rules are fixed. Every terminal settlement consumes the attempt authorization exactly once.

## Probability and financial alignment

`P_outcome` describes this success event for the named applicable population. A public benchmark query cohort describes benchmark tasks. It does not become an integration-acceptance or private-company forecast merely because the same connector is used.

The first library calculates Beta posterior means and equal-tail credible intervals from already admitted snapshots, then expected completion cost and contribution. All estimator, cost and commercial inputs are supplied explicitly. The example is synthetic. Actual evidence admission, signatures, authorization, HTTP/MCP transport and settlement remain separate implementation work.

Quoted principal, retained ancillary costs, buyer fallback and operator earned fees must be distinguished. The user agreed the following policy for a separately purchased attempt:

- Success pays the connector principal plus actual, separately quoted execution/evaluation charges within their caps.
- Eligible failure refunds connector principal. Only actual, attributable execution/evaluation charges within the accepted caps are retained.
- Unused execution/evaluation reserve remains the buyer's money. Crediting or withdrawing it does not create revenue.

Failure eligibility, missing verdicts, timeout/dispute handling and allocation authority still require definition. The library can represent full principal refund with `failureRetention: 0`; retaining consumed services belongs in the expected service bill, not an extra principal charge.

## Reserve credit and agent-controlled withdrawal

The user requires a minimum and an agent-configurable bar above that minimum. The proposed implementation separates the execution reserve needed for a quoted task from the threshold used to batch withdrawal of settled, available credit.

Let `M` be the minimum automatic-withdrawal threshold for the funding asset, `theta >= M` the buyer-authorized agent setting, and `U` settled credit available to withdraw. Locked funds for active attempts are excluded from `U`. Settlement credits unused amounts immediately; a bar governs transfer scheduling rather than ownership of the money.

The bar's meaning is awaiting clarification:

- **Accumulated-credit trigger:** when `U >= theta`, request withdrawal of available credit.
- **Retained working balance:** preserve `theta` and request withdrawal of only `max(0, U-theta)`.

No mode or numeric minimum is selected. The proposed minimum should follow measured withdrawal expense and an explicit acceptable fee fraction, using the same asset denomination. The agent cannot bypass the quote's required execution funding by lowering its withdrawal setting. Recommend allowing an explicit close-out withdrawal below the automatic threshold so small balances do not become stranded; this is a proposal, not a finalized rule.

Withdrawal preferences require wallet authority, a permitted destination and replay protection. A threshold check can run in the company's existing agent or a simple worker. It does not require LemmaX to deploy an intelligent subagent.

## Subscription-backed attempts

Subscription billing is part of the requested scope. Keep capability/outcome identity separate from the offer's billing plan. An API or MCP interface does not determine whether access is billed per call, by a recurring plan, by seat, or through an included allowance.

For an already-paid plan, check authorized entitlement, remaining allowance, billing period and applicable usage route before quoting an attempt. Do not charge the recurring access fee again as per-attempt principal. Reserve only incremental charges and separately quoted LemmaX services. Consuming included allowance can still have an opportunity cost when it displaces other intended work.

A newly purchased or renewed subscription is a distinct commercial right. Individual retrieval failure does not automatically refund that plan's entire recurring fee; cancellation, trial and service-credit terms belong to the plan's acceptance policy. Per-case quality probabilities cannot substitute for plan-activation or period-level acceptance evidence. [Subscription comparison mathematics](LemmaX-Math-and-API.md#subscription-and-usage-billing).
