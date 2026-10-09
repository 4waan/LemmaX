# Implemented assessment boundary

Version 0.1.0, October 9, 2026. These exports are local/server-side computational functions. The HTTP and MCP wrappers in the design document are not yet implemented.

## Inputs and authority

`assess({context, policy, asOf, offers})` takes a frozen epoch-second `asOf` for reproducibility. The server, not an untrusted assessment request, must supply admitted snapshots, quote economics, operator terms and configured policies.

The context names `outcomeSpecRef`, `contextRef` and `evidenceKind`. Forecast kinds are `capability_benchmark` or `acceptance_attempt`; conformance checks are eligibility/evidence context, not interchangeable task-success counts.

The explicit policy contains `policyRef`, `alpha`, `beta`, `coverage`, `minimumCases` and `maximumAgeSeconds`. There are no production defaults. Each Beta shape must be at least 0.5 and posterior total at most 10,000. Unsupported totals return unknown evidence rather than a fabricated probability. Wider numerical coverage is later work.

Each offer names its exact `offerRef` and an upstream `eligibility` result (`eligible`, `ineligible` or `needs_check`). Snapshot admission matches the offer, outcome, context, kind and policy, with a `snapshotRef`, observation time, success/failure/unresolved counts, and upstream completeness/independence flags.

Those flags are trusted admission results, not cryptographic checks. The library cannot establish that observations were independently sampled, fully reported or honestly evaluated. The transport must never let a buyer invent these flags or counts.

## Buyer cost assumptions

All values use the same declared `currency` and carry an `assumptionRef`:

- `attemptOverhead`: expected `W + (T-S) + G + D`, excluding purchase principal and failure fallback/loss. Count costs once.
- `purchasePrice`: full principal retained on success under this model.
- `failureRetention`: expected principal retained conditional on failure, between zero and purchase price.
- `fallbackOnFailure` and `lossOnFailure`: conditional failure expenditure/loss.
- `directCost`: the alternative completion cost for the same outcome and workload.

The library computes `attemptOverhead + p*purchasePrice + (1-p)*(failureRetention + fallbackOnFailure + lossOnFailure)`. Material missing inputs produce null cost/rank. Buyer estimates can inform a forecast, but the issuer must supply authoritative prices and terms for any executable quote.

The cost interval evaluates both probability endpoints while holding supplied cost assumptions fixed. It represents probability uncertainty only. Refund-dependent ancillary charges may change expected overhead with `p`; recompute their policy-conditioned expectations rather than treating this fixed-input range as a joint cost guarantee.

## Operator inputs

Operator terms contain matching `currency`, a `termsRef`, `successShare`, `earnedServiceFees`, `deliveryCost`, `subsidy`, `evidenceCost`, `expectedPaidAttempts`, and `minimumContribution`.

Contribution is `p*successShare*purchasePrice + earnedServiceFees - deliveryCost - subsidy - evidenceCost/expectedPaidAttempts`. Earned fees and attributable costs are expectations for the same population/horizon. Evidence expense is not also included in delivery cost. Retained escrow principal owed to another party is not operator revenue.

Missing operator inputs leave service availability unknown and suppress ranking. A contribution below the configured floor makes the service unavailable while preserving the forecast. This slice does not implement a separately authorized loss budget or the full subsidy allocation/competence policy.

## Results and disclosure

Each result includes `pOutcome`, `cReuse`, `costInterval`, `expectedSaving`, `currency`, `contribution`, `serviceAvailability`, `rank` and reasons. Estimated probabilities include the declared prior, equal-tail interval, evidence reference/counts and `calibrationStatus: not_established`.

Rank only eligible, sufficiently evidenced, available candidates by expected cost. Compare one currency and shared context; exact cost ties use the offer identifier. An unknown candidate keeps `rank: null` instead of receiving an artificial low probability or numeric last place.

The result object is internal. The public response needs explicit authorization/redaction for evidence counts, identities and operator margin. Forecast values do not authorize funding. Canonical private records, randomized commitments, evaluator signatures and atomic-unit settlement remain to be implemented.

## Verification limits

Feature tests and implementation share an author/session. The separate numerical oracle uses Python Decimal binomial-tail identities for integer-shape Beta quantiles, a closed-form half-shape distribution, and outcome-branch monetary enumeration. It avoids the production Gamma/continued-fraction implementation. Its report is bound to code hashes.

The oracle covers 216 integer-shape quantiles, nine half-shape quantiles and 400 monetary expectations. It does not cover every real-shape input, establish probability calibration, audit evidence authority, or validate a settlement contract. The external verification harness remains outside the tracked source tree.
