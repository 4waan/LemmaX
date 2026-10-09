# LemmaX: build readiness, existing assets, and testnet validation

Repository code and focused local checks were inspected at Lemma commit `e002b5b77eae5587b2946cfa2ab52a4ae35ab6ca` and LemmaXperiment commit `b912eb522af0f179763091d91472b975ca8f6194`. Existing LemmaXperiment working-tree changes were preserved.

**Conclusion:** we can start the implementation architecture and a parameterized revenue model now. The [architecture](LemmaX-Architecture.md) and [math/API contract](LemmaX-Math-and-API.md) already define their foundations. Six decisions below determine the executable MVP. Prices, revenue forecasts, comparative model results, partner adoption, and a Monad deployment are not established.

The user confirms that no other hackathon team is currently lined up. Prepare an integration package first. Internal use by our two projects is useful evidence, but independent adoption remains an unfilled validation target. No outreach or external publication was performed in this review.

Repository note: this review precedes the first assessment-library implementation. See the [current README](../README.md) and [paid-unit specification](Paid-Unit.md) for implementation progress. Source paths below identify inspected sibling projects, not files vendored into this repository.

## 1. Decisions remaining, in dependency order

### 1. Match the paid unit to the measured outcome

**Proposed demo unit:** one bounded retrieval task through a versioned MCP connector, returning up to five authorized source references with provenance. Its quote freezes the corpus/profile, limits, evaluator, and settlement policy. This is a service attempt; it does not imply ownership of model weights or a perpetual connector license.

The accepted quality predicate is at least one labeled relevant source among those references. We still need a deadline, expenditure allowance, permission/freshness requirements, and rules for unsupported queries. A benchmark case, a whole benchmark batch, a company integration, and a license purchase have different success events.

Align `p`, the priced service, and the refund event. A query-hit probability cannot stand in for the probability that an entire integration or licensed deployment is accepted. Even one-case pricing does not make SciFact evidence transferable to a company's unrelated workload. A demo forecast must name its reference population; unsupported contexts return unknown.

### 2. Freeze the first comparable offers and common interface

**Proposed initial asset class:** `authorized_source_retrieval`, exposed through an MCP search tool. Compare a lexical connector and a pretrained model-backed connector against the same corpus, cases, output schema, limits, and acceptance rules. These are proposed offers, not two ready catalog products.

Each listing needs release identity, connector/adapter version, model/provider settings where applicable, delivery form, supported inputs, authorization boundary, prices/metering, terms, and evidence references. A model-backed MCP connector belongs to both the connector and model categories without needing two unrelated success scores.

Hosted access and company-run weights remain desired delivery forms. Their actual demo paths, available hardware, license rights, and hosting costs require selection. The same model deployed twice may have similar relevance but different setup costs, latency, privacy, and eligibility. Do not invent a quality difference to populate the chart.

### 3. Approve the evidence and probability policy

Freeze public dataset versions and labels before comparison. Decide the estimator prior, interval coverage, evidence minimum/freshness, duplicate/cluster handling, and timeout/unresolved admission rules. The proposed Beta estimator is cheap arithmetic; reliable evidence still requires work.

Keep three ledgers distinct: capability benchmark cases, deployment/conformance checks, and authorized company acceptance attempts. Paired query outcomes help compare offers; repeated queries and retries do not automatically increase independent sample size. Shared-corpus dependence and domain transfer limit uncertainty claims.

Use the public SciFact result as an external relevance baseline. Add a separately labeled developer-document corpus for our own integration demo. Neither proves performance for all business knowledge bases. Collect later outcomes prospectively to evaluate forecasts; do not claim calibration from fitting and displaying the same observations.

### 4. Freeze evaluator, refund, and confidentiality rules

Choose a company-approved evaluator execution location and signer, funding-party acceptance of its authority, verdict format, signing-key rotation, deadline, dispute access, and retention. Prefer evaluating private records within the approved company environment where practical.

The user agreed full connector-principal refund for eligible failure, with only actual separately quoted, capped execution/evaluation charges retained. Unused reserve is buyer-owned credit. Resolve failure eligibility, withdrawal threshold versus retained-balance semantics, what happens without a timely verdict, and who receives each allocation. The contract must authenticate and bind the signed outcome to the funded attempt, chain, contract, quote/policy, nonce, and deadline.

Publish only the randomized attempt commitment, settlement outcome, and necessary financial/authorization state. Existing public resource identifiers and evaluator report links cannot be carried over automatically. Wallets, payees, amounts, and timing can still reveal relationships; a commitment does not eliminate that metadata exposure. No ZK or FHE dependency is needed for the chosen trust model.

### 5. Select commercial rights, costs, and fee policy

Decide who sells the connector service, who bears inference/hosting costs, the service allowance, charge denomination, and whether LemmaX earns an attempt fee, a successful-service share, or both. Establish rights to redistribute or commercialize code, models, and datasets. A project-level license was not identified for either repository during this inspection; individual SPDX labels and dependency licenses do not establish blanket publication rights.

Measure attributable execution, evaluator, RPC/settlement, storage, and support costs. Select evidence refresh horizon and expected paid reuse before amortizing its cost. An available reference benchmark is not free to maintain indefinitely. Native or minted testnet tokens can demonstrate accounting, but do not establish a commercial currency or real revenue.

### 6. Define the external integration and submission evidence

Target a team whose agent needs source retrieval with citations and has an authorized corpus plus checkable relevance cases. Supply one MCP configuration, an equivalent HTTP endpoint, a small runnable client, profile/manifest examples, testnet access, and a documented funding/verdict/settlement flow.

The partner should run its own integration, name its actual task, and provide permission for any public evidence. Measure what changes compared with its existing approach. Until a partner exists, build and label an internal integration rather than representing it as traction. Outreach is a separate action requiring explicit authorization.

## 2. What we can reuse from Lemma

**Catalog and deterministic resolution.** Catalog resolver (`Lemma/packages/catalog/src/resolve.ts`) and catalog loading/integrity code supply versioned manifests, applicability checks, and deterministic lookup. Replace the present model-cost-saving ordering with the LemmaX `P_outcome` and `C_reuse` library. The two current `0.1.0-skeleton` releases are preview-only payment examples with placeholder economics and no acceptance evidence. They are not sellable retrieval connectors.

**MCP and persistence.** Server MCP entry point (`Lemma/apps/server/src/mcp.ts`) and server persistence provide structured tool handling, offer snapshots, idempotency, and recovery patterns. Preview/recovery are implemented; the paid-resolution registration remains a seam. Rework public read models, receipt authority, old patch/adoption schemas, and Arbitrum-specific configuration for the new private workflow.

**Local execution and receipts.** Bridge acceptance runner (`Lemma/apps/bridge/src/acceptance.ts`) provides bounded subprocess execution, restricted environment handling, local checks, and receipt construction. Bridge code also contains drift checks and retry/delivery handling. Reuse those controls for the evaluator. Do not turn the directory query into an integration-planning agent or reuse an unauthenticated buyer report as an approved verdict.

**Accounting, evidence, and UI.** Core pricing (`Lemma/packages/core/src/pricing.ts`), atomic-amount utilities, digests, schemas, and policies are useful foundations. Benchmark evidence (`Lemma/packages/benchmark/src/evidence.ts`) supplies provenance and paired-report patterns. Its existing savings gates are not retrieval probabilities. The read-only web application supplies UI and provenance patterns; its patch/warranty views need new content. Lemma's warranty contracts remain scaffolded.

## 3. What we can reuse from LemmaXperiment

**Contract safety patterns.** CreationBounty (`LemmaXperiment/contracts/src/CreationBounty.sol`), ModuleRegistry (`LemmaXperiment/contracts/src/ModuleRegistry.sol`), and UsageEscrow (`LemmaXperiment/contracts/src/UsageEscrow.sol`) implement frozen policy/version references, signature or proof binding, replay controls, allocation, withdrawal, and solvency patterns. Their local tests are a stronger starting point than Lemma's contract scaffold.

Reuse patterns and applicable invariants in a smaller LemmaX attempt contract. The existing contracts expose resource/version and other identifying fields. UsageEscrow verifies an SP1 Ethereum-block computation, rather than a company-approved retrieval verdict. They require adaptation and privacy review; they are not drop-in Monad settlement contracts.

**Evaluation discipline.** Evaluation freezing (`LemmaXperiment/evaluation/freeze.py`), fixture manifests, policy files, and paired analysis (`LemmaXperiment/evaluation/analysis/paired.py`) provide reproducibility, holdout, and independent-check patterns. Their trie correctness and computation-cost measurements do not measure retrieval. The paired-analysis self-test is synthetic, not evidence of a successful candidate benchmark.

**Optional bounded automation.** The agent runner provides constrained tool configuration, budget/timeout controls, and run-record provenance. It may help a separately scoped evaluation workflow later. Its agent/proof infrastructure is unnecessary for a deterministic directory query. Historical proof records report hours of proving for the existing guest; those records are not a cheap new retrieval verification path.

**Candidate status.** Candidate manifest (`LemmaXperiment/candidate/manifest.json`) remains `unsubmitted`, with identity, artifact, licensing, and evaluation fields unset. Historical deployment reports concern another chain and were not revalidated here. There is no accepted model/connector candidate or demonstrated external reuse to list as a finished LemmaX asset.

## 4. Turn existing resources into a valid asset-class experiment

There are three different roles for these resources:

1. **Product infrastructure:** use Lemma's catalog/MCP/accounting and LemmaXperiment's settlement/evaluation patterns to build LemmaX.
2. **Integration fixture and corpus:** after rights and disclosure checks, allowlist public developer documentation from both repositories, freeze commits/content hashes, and create source-retrieval questions with independently checked gold references. Exclude credentials, raw agent logs, private records, and unreviewed artifacts. Questions should require references, not generated answers.
3. **Benchmarkable commercial offers:** implement and version the actual search connectors. A repository, a corpus, or an unsubmitted manifest is not itself a finished model offer.

For example, a question about the public values required by UsageEscrow can have exact gold contract/document references. Such cases test developer-source retrieval. Include paraphrases, absent information, authorization-denied references, and stale/deleted documents. Freeze a development split and a held-out evaluation split before tuning. A second domain and independent labels reduce reliance on handpicked questions; they do not prove generalization to every business.

Both offers must search the same permitted corpus in each comparison. Comparing one connector on Lemma documents against another on LemmaXperiment documents confounds the resource with the workload. Report paired case outcomes, relevance metrics, end-to-end cost/latency, and access/freshness checks separately.

The executed [SciFact report](../benchmarks/scifact-bm25-results.json) contains 5,183 documents and 300 test queries. The untuned lexical baseline hit a relevant source in the top five on 224 queries, or 74.67%. No paid API calls or model training were used. Separate metric recomputation passed, but the run is neither comparative model evaluation nor company acceptance evidence. It is also not an API load test.

## 5. Concrete Monad testnet use case

**Proposed demonstration:** a developer agent chooses and buys one bounded source-retrieval attempt using a LemmaX assessment. The output is ranked source references, not an agent-generated adoption plan.

1. Query the HTTP/MCP assessment endpoint for two exact offers under a common frozen profile. Show applicable benchmark evidence, probability intervals, expected completion costs, and unknown/ineligible conditions. Company acceptance estimates stay unknown unless supported.
2. Freeze the chosen quote and private acceptance specification. The authorized wallet funds an attempt on Monad testnet with a randomized commitment and minimal enforcement fields.
3. Execute the selected connector. The approved evaluator privately checks relevance, authorization, provenance, and the quoted limits, then signs a bound verdict.
4. Submit that verdict. The contract releases the defined allocation on success, or applies the selected eligible-failure refund policy. Show both paths and rejection of a replay or mismatched verdict.
5. Reconcile contract state with the private receipt and evidence snapshot. Publish only approved, redacted integration evidence.

Monad supplies shared funding, ordering, execution, and settlement state for independently operated agents and evaluators. It does not infer compatibility, store private corpora, or certify an evaluator's judgment. Confirm current RPC/token settings from [official testnet documentation](https://docs.monad.xyz/developer-essentials/testnet) during deployment. Nothing in this review was deployed.

ERC-8004 identity/reputation can be an authorized extension. The [official Monad guide](https://docs.monad.xyz/guides/erc-8004) currently marks validation as coming soon; do not make that registry a dependency. Optional indexing should serve real reconciliation and status display. Native blobs, zkML proving, and FHE remain outside this four-day dependency chain.

## 6. Evidence that makes the demo useful

**Task quality:** run both connectors on identical frozen cases; retain failures and uncertainty. Avoid test-set tuning. Relevance probabilities describe the named population, not universal integration compatibility.

**Economic usefulness:** compare the partner's existing approach with assessment-assisted selection under the same requirements. Measure accepted outcomes, actual total cost, elapsed integration effort, and rejected/inapplicable offers. Existing behavior may be the cheaper choice. A tool invocation alone does not establish savings, willingness to pay, or improved outcomes.

**Settlement correctness:** independently check signed-verdict bindings, wrong signers, replay, timeout policy, allocations, withdrawals, and liability conservation. Demonstrate one successful settlement and one eligible refund on the target testnet.

**Confidentiality:** inspect events, calldata, dashboard/indexer output, and error/log paths for private record disclosure. Permission revocation, cross-tenant access, and stale/deleted-source cases need actual tests.

**Scale readiness:** run the minimum protocol already in the [architecture](LemmaX-Architecture.md#minimum-evidence-of-scale-readiness): assessment requests versus evidence/catalog growth, actual evaluator throughput/cost, retry/deduplication correctness, and settlement/indexing reconciliation. Record hardware, load, duration, achieved rate, latency/error/cost, versions, and observed limits. Do not equate transaction speed with retrieval/evaluation capacity.

**Independent adoption:** preserve a partner-owned integration change or runnable client, its task/profile, permissioned evidence, testnet transactions, and concrete feedback. Internal LemmaXperiment integration is valuable dogfooding, but it is not another team's adoption. Without a partner, report this limitation and provide a specific integration path.

## 7. Revenue model we can produce now

The initial proposal is cached discovery/assessment plus a funded, metered connector service. A successful-service share and/or an evaluation fee remain policy choices. Private-company evaluation subscriptions may be a later offer; enterprise willingness to pay is unmeasured.

For one aligned paid-attempt population and horizon:

```text
contribution per attempt = p * tau * P + F - C - S - K/N
monthly earned revenue   = sum(actual LemmaX fees and earned service shares)
monthly operating result = monthly earned revenue - actual costs - fixed overhead
```

Use the general expected-earned-revenue form if the chosen policy does not earn a share only on success. `F` is expected earned service fees under its refund rules, not an automatically retained charge. If operators collect net fees after subsidies, do not subtract the same subsidy twice. Exclude evidence expense from `C` when it is already counted in `K/N`.

Escrow principal owed to publishers or customers is a liability, not revenue. Testnet token transfers are accounting demonstrations. Buyer-owned compute is not automatically a LemmaX expense. Break-even paid volume is fixed overhead divided by positive, population-weighted contribution, with forecast uncertainty and evidence refresh costs included. If contribution is nonpositive, increasing volume does not repair that unit model.

Subscription billing is also in scope. Compare an authorized existing plan by incremental cost and acquisition/renewal by its added fixed fee, allowance, overage and actual workload horizon. LemmaX's own plan revenue follows a period-level contribution model; it is not a success fee earned afresh on every included query. [Subscription and usage mathematics](LemmaX-Math-and-API.md#subscription-and-usage-billing).

Remaining inputs are real tariffs, failure eligibility and exact consumed-charge allocation, withdrawal policy, operator costs, refresh cost/horizon, paid volumes/conversion, and support burden. We can produce the equations, ledger, and sensitivity analysis now; a credible revenue forecast waits for these measurements. Benchmark-case `p` cannot price an unrelated integration-success share.

## 8. Hackathon criteria and four-day order

The official **Trust, Identity & AI Infrastructure** rubric assigns **20% to Traction & Path Forward**. Another team integrating during the hackathon is an example of traction evidence, rather than a separate mandatory validation score. The track also weights market readiness at 25%. Check the submission deadline in the portal. The live product, public repository, access instructions, logo, and technical/pitch videos need submission preparation. [Official track](https://hackathon.monad.xyz/tracks/trust-identity-ai).

**Day 1:** resolve decisions 1 and 2, freeze cases/interface/evidence policy, and prepare the small partner integration package. Identify a suitable partner without promising adoption.

**Day 2:** implement the deterministic library and HTTP/MCP flow using the reusable components; run comparable connectors and conformance checks. Record costs and unknown contexts accurately.

**Day 3:** implement the minimal private-record settlement contract, verify it locally, and deploy/demo the target testnet paths. Exercise an independent integration if a team agrees.

**Day 4:** run scale and reconciliation checks, collect any independent feedback, complete the cost ledger/revenue scenarios, and record the live demo and submission materials. Keep submission time outside final implementation hours.

This order is a scoped proposal, not a guarantee that every optional delivery form or sponsor will fit.

## 9. Verification performed in this review

- Lemma core/catalog/server focused run: **117 passed, 1 failed**. The failing catalog fixture attempts to create an invalid UTF-8 filename on macOS. Fixture construction failed both inside and outside the sandbox, before the checker could run. That case still needs a suitable filesystem/platform; the suite is not fully green.
- Lemma bridge focused run: **24 passed**.
- LemmaXperiment existing contract tests: **37 passed**, including its stored proof fixture and solvency checks. These are local checks of the existing contracts, not the new Monad workflow.
- LemmaXperiment paired-analysis self-test: **12 synthetic scenarios passed**. No new candidate performance result was produced.
- Existing SciFact metric verification: query metrics and aggregates independently recomputed. No model-backed retrieval, live connector, load test, or independent customer outcome was measured in this review.

Source code was not migrated or changed. No partner was contacted, funded job started, paid model API called, proof generated, or Monad contract deployed. The next discussion should resolve decision 1, then decision 2, rather than reopen the already agreed directory/privacy boundary.
