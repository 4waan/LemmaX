# LemmaX paid unit: bounded source-retrieval attempt

This is what one purchase covers: one bounded search attempt. We refund the search price on an eligible miss, because the buyer pays for a found source, not for a try. The version 1 tariff, deadline profiles and automatic payouts are fixed in versioned terms ([version 1 terms](Monad-Settlement-Path.md#6-version-1-terms)). Customer tariffs and limits still need real pricing.

## What is listed and purchased

The asset class is `authorized_source_retrieval`. A listing identifies one versioned connector capability, including its adapter and model/provider/runtime configuration where applicable. It can be exposed through MCP or equivalent HTTP.

The measurement unit is one bounded attempt against a frozen task and corpus/access profile. Its result contains up to five ranked source references with provenance. The attempt includes the declared retry allowance and its aggregate consumption. A retry is not a new independent benchmark case. Resource access may be billed per use or covered by a subscription; an attempt is not necessarily a fresh purchase of access already paid for.

Each reference needs source/document identity within the private boundary, source version, location sufficient to verify provenance, and rank. The public offers return `sourceRef`, `sourceVersion`, `location` and `rank`, and `lemma_read_source` returns excerpts of at most 1000 characters. [Retrieval and MCP](Retrieval-and-MCP.md).

The purchase terms must state the service allowance and deliverable rights. The unit does not automatically grant a perpetual connector license, transfer model ownership, or authorize unrestricted corpus access. Hosted and company-run offerings may both implement this capability, with distinct applicable contexts and costs.

## Frozen acceptance boundary

For the initial answerable retrieval cohort, success requires all of:

1. At least one evaluator-labeled relevant source among at most five returned references.
2. Every returned reference is authorized for the requesting principal and preserves verifiable provenance.
3. Required source-version/freshness conditions hold.
4. The entire allowed attempt completes within its quoted deadline and expenditure/consumption allowance.

We fixed the relevance predicate first. The demonstration's time and cost limits are set in versioned [deadline profiles](Monad-Settlement-Path.md#deadline-profiles) and tariffs. Freshness and retry limits for customer use remain open, and none gets a silent default. Known unsupported tasks should fail eligibility before funding where possible. Missing labels or telemetry are unresolved evidence, rather than automatic task failures.

Authorization-denied, stale/deleted-source and unsupported-query tests also belong in conformance evaluation. Correct abstention in a denied-access fixture must not be counted as a relevant-source success. A future abstention service can have a different outcome profile.

## Quote and private record

A fundable quote needs exact offer/context/outcome versions, private task/input references, corpus and access snapshot, limits, buyer and payee authorization, evaluator authority, priced service and ancillary charges, refunds, timeout rules, quote expiry, and attempt nonce.

Detailed fields stay private. A randomized commitment binds the record to minimal Monad financial and authorization state. A signature and commitment authenticate bindings; neither proves honest evaluator execution. Private-record/signed-quote primitives and a USDC settlement prototype are implemented and tested locally and against testnet USDC on a fork. Contract version 3 is deployed on Monad Testnet, and version 2 ran the earlier live attempts. Only an operator-configured MCP server issues fundable quotes, and none are offered to customers. [Implemented financial boundary](Attempt-and-Settlement.md).

## Attempt states

```text
draft -> quoted -> funded -> executing -> awaiting_evaluation
awaiting_evaluation -> settled_success
awaiting_evaluation -> settled_failure
funded, executing or awaiting_evaluation -> refunded_timeout
```

Failure eligibility and allocation are evaluated under frozen terms. We refund the full locked amount when no valid verdict arrives by the settlement deadline, so the buyer never pays for a check that did not happen. Unresolved evidence cannot settle; cancellation and dispute/correction rules for customer use remain open. Customer funding through the public demo remains unavailable. The operator's purchase path funds attempts from the buyer's EIP-3009 authorization, as in the testnet run. Every terminal settlement consumes the attempt authorization exactly once.

## Probability and financial alignment

`P_outcome` describes this success event for the named applicable population. A public benchmark query cohort describes benchmark tasks. It does not become an integration-acceptance or private-company forecast merely because the same connector is used.

The first library calculates Beta posterior means and equal-tail credible intervals from already admitted snapshots, then expected completion cost and contribution. All estimator, cost and commercial inputs are supplied explicitly. The example is synthetic. The public benchmark stdio MCP transport is implemented. Signatures and USDC settlement are implemented; private-company evidence admission and an authenticated remote transport remain separate work. [Implemented public connector boundary](Retrieval-and-MCP.md).

Quoted principal, retained ancillary costs, buyer fallback and operator earned fees must be distinguished. We use the following policy for a separately purchased attempt:

- Success pays the connector principal plus actual, separately quoted execution/evaluation charges within their caps.
- Eligible failure refunds connector principal. Only actual, attributable execution/evaluation charges within the accepted caps are retained.
- Unused execution/evaluation reserve remains the buyer's money. Crediting or withdrawing it does not create revenue.

The timeout rule is fixed: no accepted valid verdict by the deadline returns the entire locked amount without service deductions. Failure eligibility, dispute/correction policy and real allocation/evaluator authority still require definition. The library can represent full principal refund with `failureRetention: 0`; retaining consumed services belongs in the expected service bill, not an extra principal charge.

## Reserve credit and automatic payouts

Credit owners need a minimum payout and a bar they can raise above it. Contract version 3 implements both. Settlement credits unused amounts immediately. Once an owner's settled credit reaches its bar, the whole credit is paid out inside that same transaction. [Contract version 3](Trust-Loop.md#1-the-monad-problem-stranded-agent-funds).

Let `M` be the minimum, 0.01 USDC, `theta >= M` the owner's bar, and `U` its settled credit. Locked funds for active attempts are excluded from `U`. When `U >= theta`, the contract pays all of `U`. We chose this accumulated-credit trigger over a retained working balance, which would keep `theta` and pay only `max(0, U-theta)`. The bar schedules transfers and never changes the amount owed. The agent cannot bypass the quote's required execution funding by changing its bar.

An owner raises its bar or routes payouts elsewhere with one signed `PayoutInstruction`, which any wallet can relay. The instruction names a destination other than the contract, a nonce and a deadline, and its nonce stops replay. Credit below the bar stays the owner's money, and an owner holding MON can close it out with `withdraw`. No LemmaX agent or worker is needed to schedule payouts.

## Subscription-backed attempts

Subscription billing is in scope. Keep capability/outcome identity separate from the offer's billing plan. An API or MCP interface does not determine whether access is billed per call, by a recurring plan, by seat, or through an included allowance.

For an already-paid plan, check authorized entitlement, remaining allowance, billing period and applicable usage route before quoting an attempt. Do not charge the recurring access fee again as per-attempt principal. Reserve only incremental charges and separately quoted LemmaX services. Consuming included allowance can still have an opportunity cost when it displaces other intended work.

A newly purchased or renewed subscription is a distinct commercial right. Individual retrieval failure does not automatically refund that plan's entire recurring fee; cancellation, trial and service-credit terms belong to the plan's acceptance policy. Per-case quality probabilities cannot substitute for plan-activation or period-level acceptance evidence. [Subscription comparison mathematics](research/LemmaX-Math-and-API.md#subscription-and-usage-billing).
