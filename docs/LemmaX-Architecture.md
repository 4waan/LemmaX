# LemmaX: private adoption, public commitments, and settlement

This document explains what LemmaX keeps private, what it puts on Monad, and why. It separates the design choices we made from proposals that remain open.

**Status:** the design is built for one capability, a bounded search on a public benchmark. Contract version 3 is deployed on Monad Testnet ([deployment record](../deployments/AttemptSettlement-v3.testnet.json)). Contract version 2 ran three live attempts there ([run report](../verification/testnet-demo.json)). The trust loop with Envio, Privy and ERC-8004 is built and tested, and it was rehearsed on a fork with a local auditor and mandate ([trust loop](Trust-Loop.md)). The [README](../README.md#verify-it-yourself) distinguishes live transactions from local and fork checks.

## 1. Context and decisions

The project is **LemmaX**. Its product and economic boundaries are documented in the math/API research note. Earlier repository and document names remain historical references.

This document carries that context forward and supersedes the earlier proposed placement of attempt information wherever it conflicts with the privacy decisions below.

The [decision mathematics and API specification](research/LemmaX-Math-and-API.md) defines the corrected MVP boundary. Numerical probability, expected-cost ranking, and contribution-governed service offers take precedence over earlier adoption-plan proposals.

The [blob-storage research](research/LemmaX-Blob-Research.md) records current Monad restrictions, optional Ethereum publication, retention and confidentiality limits, and cost allocation. Its integration recommendations remain proposals.

The [business requirements and benchmark evidence](research/LemmaX-Business-Requirements.md) compares extraction, classification, and retrieval using published buyer workflows, evaluation requirements, data access, and cost components. It includes an executed public retrieval baseline. The tentative knowledge base is not treated as trusted or authorized evidence. We later chose retrieval as the first capability.

**Design choices:**

1. Development companies are the target customers; their agents transact through company-authorized wallets.
2. Purchase funds remain locked during adoption. Eligible unsuccessful adoption receives the agreed refund after security checks. Integration is not guaranteed.
3. Compatibility assessment should start with explicit checks, executable probes, and relevant measured outcomes. Custom model training is not required for the initial product.
4. Consumption is measured in fragments offchain. Reputation affects subsidy eligibility or scale, not the underlying compute tariff.
5. Private adaptations do not automatically become catalog assets.
6. For an adoption attempt, the public application records are the **attempt commitment** and **settlement outcome**. The selected resource and detailed company record remain private.
7. A **company-approved evaluator** is the chosen direction. Requiring external parties to verify a proof of the full private record is outside the initial scope, because we judged it excessive and more costly for a first version.
8. Monad is the settlement chain, and LemmaX runs on Monad Testnet.
9. Our initial confidentiality direction uses company-controlled detailed records, conventional encryption where needed, randomized commitments, and signed evaluator verdicts. ZK and FHE are not initial requirements. Exact storage, keys, and evaluator access remain implementation decisions.
10. Reuse ERC-8004 identity and selected authorized feedback. LemmaX owns acceptance policy, compatibility mathematics, private evidence, metering, and settlement. The initial workflow uses the approved evaluator directly, without a dependency on Monad's forthcoming validation registry.
11. The MVP is a deterministic resource directory returning `P_outcome`, `C_reuse`, and contribution-governed service availability through a clear API. Generating an integration plan or managing adoption is not part of its initial assessment deliverable. Optional agent work is a separately scoped future service.
12. The desired directory scope includes both callable model access and downloadable model weights/adapters for company-controlled execution. Sellable connectors and MCP tools are favored; general reusable code is not the preferred initial category. The first capability is source retrieval through MCP connectors.

13. The measurement unit is one bounded task case with a specific input, expected result, context, and limits. A versioned benchmark batch evaluates those cases. The commercial listing is a versioned capability offer. Benchmark-case success and company-adoption success retain different scopes.
14. The first release must include minimal reproducible evidence that the approach can scale. Load levels, hardware, budgets, performance thresholds, and extrapolation limits must be explicit. The scale protocol in section 10 has not been run; a bounded local MCP probe is recorded.
15. We adopted the initial retrieval quality criterion: at least one labeled relevant source among up to five ranked, authorized references, with provenance. The first offers are BM25 and TF-IDF connectors on the public SciFact corpus, with version 1 deadlines and tariffs in versioned terms.
16. Per-resource probability comparison is part of the directory output. Each bar estimates success against the same declared acceptance profile and carries evidence and uncertainty. These separate success probabilities need not sum to one. The values `0.84`, `0.05`, and `0.11` are illustrative, not measured resource estimates.
17. For a separately purchased attempt, success pays connector principal plus actual separately quoted execution/evaluation charges within their caps. Eligible failure refunds connector principal and retains only those consumed charges. Unused reserve remains buyer-owned credit.
18. Payouts need a minimum and an owner-controlled bar above it. Contract version 3 pays the whole credit once it reaches the bar, with a 0.01 USDC minimum, and `withdraw` closes out smaller balances. The bar never changes the amount owed.
19. Subscription-billed resources are within scope alongside usage-billed resources. Capability/outcome and billing-plan identities remain separate. Compare costs over a common workload/horizon, account for authorized existing entitlements, and do not treat a recurring fee as a new successful-query purchase.

The assessment output is fixed as structured numerical results. Version 1 terms fix the first offers, deadlines, tariff, timeout refund, payouts and integrations. LemmaX operates both evaluators today, as the rulebook declares. Customer failure eligibility, disputes, subscription rights and tariffs, and subsidy funding remain open. The [paid-unit specification](Paid-Unit.md) records the refund policy and payout rules.

## 2. Product and component boundary

**Confirmed product boundary:** LemmaX is a directory that gives a company's agent structured outcome probabilities and expected completion costs over comparable resource offers. Its service offers are governed by explicit contribution accounting. Acquisition uses the separate agreed commitment, evaluator, and settlement workflow.

The directory distributes public releases, supported interfaces, reference evidence, offers, and permitted summaries. Public discoverability of a resource does not imply public disclosure that a particular company used it.

For model resources, both delivery forms belong in the desired directory scope. A hosted offer grants the specified inference access; a downloadable offer grants the specified artifact access and usage rights for company-controlled execution. Access does not imply ownership or unrestricted redistribution. Exact rights, licenses, billing units, and acceptance/refund terms remain open.

The common catalog boundary is a capability with distinct versioned offers. One underlying model could have a hosted offer and a self-hosted artifact offer. Both may be assessed against a shared task outcome, but probability estimates remain specific to their deployment, adapter, configuration, and admissible evidence. Hosted observations cannot automatically establish local deployment success.

Expected-cost comparisons must use the same planned workload and acceptance boundary. Hosted service charges, local setup, hardware/runtime costs, and purchased rights enter the existing accounting as applicable. A per-call quote and a one-time artifact license are not directly comparable until the workload horizon is supplied. This proposal does not select a new billing model or guarantee refunds of consumed usage or execution costs.

The company client holds its repository context, private adaptations, acceptance policy, detailed history, spending authority, and encryption keys. It can expose a narrow MCP interface to the company's agent. MCP is an interface to ordinary tools and services; serving a tool does not itself require inference or training.

The assessment component retrieves a bounded candidate set, applies deterministic applicability checks, and calculates probability, expected completion cost, and service availability. It returns structured results and missing-evidence states. The company supplies its strategy; LemmaX does not generate an integration plan. An existing-model worker remains a separately scoped future service and is not required by the MVP query.

The runner performs adoption and acceptance inside an approved execution boundary. A company-controlled runner or CI job is the proposed inexpensive starting point. A company-approved evaluator checks the exact frozen terms and signs the financial verdict.

Monad holds escrow state, the attempt commitment, and the terminal settlement record. The Envio indexer reads those public records as an auditor for the buyer ([trust loop](Trust-Loop.md)). The detailed attempt record remains in company-controlled storage, with authorized evaluator access where necessary.

The [decision mathematics](research/LemmaX-Math-and-API.md) and [reuse review](research/LemmaX-Build-Readiness-and-Reuse.md) define the current buyer, operator, and implementation boundaries. Privacy limits which observations may be collected or published; it does not change the accounting identities.

## 3. What is public on Monad

The selected boundary concerns the two application records. A functioning public escrow also exposes ordinary financial and authorization state: wallets, token, amounts, evaluator authority, deadlines, transaction timing, and consumed authorizations. These must be documented honestly.

### Attempt commitment

The implemented `private-attempt/v1` record names the exact offer, outcome, task profile, principal, access snapshot, terms, input digest, source version and execution limits. Its encoding, bounds and commitment construction are defined in [`src/attempt.mjs`](../src/attempt.mjs) and the [attempt guide](Attempt-and-Settlement.md#private-record-and-commitment).

The record hash uses fixed ABI fields containing the schema hash, reference hashes, digests and bounded integers. The commitment binds that hash to fresh 32-byte cryptographic randomness under a separate domain. Keep the record and salt private. A bare hash of a guessable resource identifier would permit catalog enumeration; the random salt prevents that simple attack under the hash assumptions.

The issuer signs a quote containing the commitment, buyer, token, amounts, payees, evaluator authority and deadlines. EIP-712 binds that quote to its chain and settlement contract. `bindRecordToQuote` checks the private opening and the shared amount/deadline fields before execution. The contract stores the quote digest and state; contract v3 also emits the public quote terms for audit. Detailed acceptance and resource references stay offchain.

AES-256-GCM sealing and opening helpers are implemented. The demonstration issuer keeps its records in memory; encrypted persistent custody and authenticated company access remain separate work. Future circuit compatibility has not been established.

### Settlement outcome

The evaluator signs a receipt binding the attempt ID, quote digest, evidence commitment, outcome, consumed charges and execution/evaluation times. The signing domain fixes the chain and contract. The evaluator checks that the private record opens the funded commitment and that the selected acceptance policy was followed.

The contract verifies issuer authority, authorized amounts and state transitions, deadline conditions, and replay protection. It then credits the agreed payouts or refunds exactly once. Financial checks cannot be delegated to model prose.

The public outcome event records the attempt ID, terminal state, evidence commitment and consumed execution/evaluation charges. Credit and payout events expose the resulting transfers. A failure outcome need not publish a detailed reason, stack trace, resource ID, or diagnostic tag. Consumption fragments and intermediate failures stay private; the agreed aggregate financial allocation is enforced.

An evaluator signature authenticates the verdict. It does not prove the evaluator ran tests honestly. The funding parties must accept the evaluator and evidence policy before funds are locked. Company approval alone does not resolve provider acceptance or conflicts of interest.

### Metadata limits

Do not put private resource IDs, catalog URLs, project hashes, acceptance text, logs, or resource-specific feedback tags into calldata, events, revert messages, public storage locations, or analytics payloads. Leaving a field out of an event does not hide it if calldata or contract storage contains it.

Even with that discipline, a unique price, publisher payee, evaluator address, or transaction timing may identify the resource or company. ZK over the detailed record would not conceal an ordinary token transfer. Hiding those financial relationships would require an additional payment privacy design, which has not been selected.

## 4. Settlement and ERC-8004 reputation

ERC-8004 standardizes agent identity, feedback, and validation interfaces. Its specification explicitly excludes payments. Feedback may be derived from a settled attempt, but escrow release and refunds remain LemmaX's responsibility. [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004).

Standard feedback exposes the agent, client address, value, and any supplied tags or references. Submitters cannot be the target agent's owner or approved operator. Automatic publication for every private attempt is therefore not proposed. [ERC-8004 reputation interface](https://eips.ethereum.org/EIPS/eip-8004#reputation-registry).

The architectural relationship is:

```text
private acceptance evidence
  -> authorized settlement verdict
  -> escrow payout or refund
  -> permitted reputation interpretation
  -> optional ERC-8004 feedback
```

These stages have different meanings. A refund does not establish a defective resource, an incompetent adopter, or evaluator misconduct. A successful payment does not establish honest evidence. Outcome attribution must follow the selected policy.

LemmaX's relevant history and subsidy eligibility can remain private or be selectively summarized. A public reputation export is a separate disclosure decision. If used, it must have an authorized issuer, an explicit meaning, duplicate handling, and a privacy review; a reputation score is not a compatibility probability. LemmaX's batched feedback, built from settled attempts only, follows these rules ([identity and reputation](Trust-Loop.md#4-identity-and-reputation-erc-8004)).

Monad's current guide describes identity and reputation integration, while its validation registry is still described as coming soon. The initial settlement path must not depend on that registry being available. [Monad ERC-8004 guide](https://docs.monad.xyz/guides/erc-8004).

## 5. What companies may need to keep confidential

Confidentiality applies to the adoption context as well as the purchased resource. The actual sensitivity depends on the company and task.

### Code and implementation knowledge

Unreleased source, private adapters, algorithms, internal schemas, service topology, repository names, feature branches, and roadmap details can reveal intellectual property or plans. An integration patch can reveal more about the company's system than the reusable package itself.

Keep execution inside the company's boundary where possible. LemmaX should receive the minimum capability requirements needed for discovery, rather than an entire repository. Local checks can return a specific mismatch or eligibility result without uploading their source inputs.

### Credentials and operational access

API tokens, signing keys, session credentials, database connection strings, environment values, and production endpoints can grant access. They do not belong in discovery requests, catalog manifests, settlement receipts, evaluator logs, or model prompts merely because integration needs them.

Provide narrow test credentials or fixtures inside the approved runner only when needed. Preserve references to secret requirements rather than secret values in the attempt record. Redaction helps, but avoiding collection provides the stronger boundary.

### Customer and business data

Database samples, webhook payloads, support messages, personal information, payment data, and customer-specific configuration can expose third parties. Real data is often unnecessary to establish interface behavior.

Prefer synthetic fixtures for the initial demonstration. If a test requires private records, it runs inside the approved company environment, with its outward receipt limited to the agreed result.

### Security findings

Dependency versions, failed authentication tests, traces, unpatched vulnerabilities, internal URLs, and permission maps can reveal how to attack the company. A refund reason can disclose such a finding even when source code is absent.

Detailed failure evidence stays private. The public outcome states the financial result. The evaluator receives diagnostic detail only to the extent required by its authorized task.

### Agent context and commercial strategy

System prompts, tool permissions, memory, task instructions, model configuration, spending limits, quotes, selected suppliers, resource choices, and unsuccessful attempts can expose company practices or future products. Detailed history can also support unwanted profiling.

Keep prompts and history in the company client. Broad discovery requirements may still reveal intent to the service handling them, so send them intentionally and minimize retained telemetry. Confidentiality from the public chain and confidentiality from LemmaX are different promises.

## 6. Observer and access boundary

**Public observers and other buyers:** receive the permitted catalog plus commitment and settlement information. They may still infer relationships from payment metadata. They do not receive private records or logs by default.

**LemmaX discovery/assessment service:** receives submitted capability constraints and the permitted evidence needed for its service. Proposed default access excludes source, secret values, customer data, and full history. Local assessment is available where even capability constraints are sensitive.

**Resource publisher:** already knows its own resource. It may legitimately learn who acquires it through delivery or payment. Hiding a selected resource from the public does not automatically hide it from its seller. Callable resources may receive task inputs; downloadable resources executed locally can avoid that disclosure. The first subtype remains open.

**Company-approved evaluator:** receives the minimum evidence needed to check the frozen acceptance specification. Approval does not require uploading the entire record to a third party. A company CI evaluator could run tests locally and issue a bounded receipt.

**Model or execution provider:** sees whatever the approved workflow sends it, unless an independently selected confidentiality mechanism protects that input. MCP does not prevent the agent host from forwarding tool outputs to its model provider.

**Indexer and hosting operators:** receive public events or stored ciphertext, respectively. Client-side encryption can exclude storage operators from plaintext, but does not conceal access timing or object size. Operational and request logs need the same minimization as application records.

### Proposed inexpensive data flow

1. The company client reads private context locally and emits bounded discovery constraints.
2. LemmaX returns candidate releases, structured numerical assessments, and any missing required checks.
3. Approved tests and any private adaptation execute locally or in company-controlled CI.
4. The company stores the detailed record, encrypting offchain backups under company-controlled keys when needed.
5. The approved evaluator checks the private evidence and issues a job-bound verdict.
6. LemmaX submits the verdict for settlement. It can receive an opaque receipt reference rather than the full record.
7. Any reuse of detailed history for statistics or reputation requires a separate collection and disclosure policy.

Plaintext is visible to software and operators authorized to decrypt it. Encryption at rest cannot conceal data from an evaluator while that evaluator reads it. Key recovery, access revocation, retention, and dispute access remain open operational decisions.

## 7. Commitments, encryption, ZK, and FHE

Our choice of a company-approved evaluator removes proof-only verification from the initial core path. The technologies below are retained as investigated alternatives, not selected dependencies.

### Commitments and conventional encryption

A randomized commitment binds the private record to an attempt while hiding its contents from public observers under its cryptographic assumptions. It supplies no record recovery, execution evidence, or access control.

Authenticated encryption protects stored or transmitted private records from parties without keys. Company-held keys and local execution support a low-cost first version. Detailed evidence can be disclosed to an authorized evaluator without publishing the commitment opening.

**Chosen direction:** local/company-controlled records, authenticated encrypted backups where needed, randomized onchain commitments, and signed evaluator verdicts. This provides the selected privacy boundary with an explicit evaluator trust assumption. Records are sealed with AES-256-GCM, and company key custody remains open.

### Where ZK would add a useful guarantee

**Optional evidence extension, not a selected dependency:** a resource or service may supply an existing zkML proof. The approved evaluator could verify that proof against the accepted verification key and bound inputs/outputs, then include the verification result in its signed verdict. Detailed proof material can remain offchain within the approved access boundary. In this arrangement, the escrow trusts the evaluator's signature; the chain does not independently verify the zkML proof.

zkML proves the specified model computation, not the forecast's empirical calibration or successful integration into a company project. No custom training is inherently required to prove an existing supported model, but model compilation and proof generation still carry costs. There is no selected compatibility model to prove in the current scope. [EZKL execution verification](https://docs.ezkl.xyz/).

ERC-8004's validation interface can record the designated validator's result; the actual zkML verifier remains part of the validator implementation. Any future public export must preserve the selected disclosure boundary and account for registry availability. This extension does not add a new required public record to the initial escrow workflow. [ERC-8004 validation interface](https://eips.ethereum.org/EIPS/eip-8004#validation-registry).

A proof could establish a precise fact about authenticated private evidence, such as an eligible subsidy tier or membership in an approved set, without disclosing the underlying history. A proof must bind accepted issuers, current policy, the intended attempt, and a replay-safe authorization.

A proof of knowledge of a commitment opening alone does not establish that adoption succeeded. A proof over an invented success count does not establish a valid history. Inclusion of selected receipts does not prove completeness of a denominator or absence of duplicate trials.

Current practical circuit tooling includes **Noir with Barretenberg/UltraHonk**. The official project demonstrates browser proof generation and Solidity verification, including an EVM-compatible ZK configuration. Its public documentation currently displays `v1.0.0-rc.2`; this is an observed documentation version, not a guarantee about the newest binary release. [Official browser example](https://github.com/noir-lang/noir/blob/master/examples/browser/index.js), [official Solidity integration](https://github.com/noir-lang/noir/blob/master/compiler/integration-tests/test/node/smart_contract_verifier.test.ts), [Noir documentation](https://noir-lang.org/docs/).

For an eventual small private predicate, this is a reasonable candidate to benchmark. Keep the circuit bounded, generate witnesses inside the approved privacy boundary, and confirm the actual proof mode provides zero knowledge. Noir's profiler emphasizes that proving performance depends on the backend and resulting gates, rather than source length alone. [Noir profiler](https://noir-lang.org/docs/tooling/profiler).

**Circom/snarkjs with Groth16** is another established option for a fixed small circuit. It requires circuit-specific setup in addition to the reusable setup phase, which affects maintenance and security review. It is an alternative to measure, not a universally fastest or newest choice. [Circom proving guide](https://docs.circom.io/getting-started/proving-circuits/).

For larger deterministic computations, current **SP1** documentation covers V6 with a 64-bit toolchain and updated async interfaces. Its documented Groth16 wrapper is approximately 260 bytes with approximately 270,000 gas for onchain verification. Those are provider documentation figures, not measured LemmaX or Monad costs; proving, wrapping, calldata, and settlement remain additional work. [SP1 V6 migration](https://docs.succinct.xyz/docs/sp1/getting-started/migration), [SP1 proof types](https://docs.succinct.xyz/docs/sp1/generating-proofs/proof-types).

GPU/network proving can help larger workloads, but a remote prover can see submitted inputs unless an additional privacy boundary is used. Succinct's documented TEE private proving is currently an enterprise private beta. It is therefore not an assumed inexpensive, immediately available dependency for the current build. [SP1 quickstart](https://docs.succinct.xyz/docs/sp1/getting-started/quickstart), [private proving status](https://docs.succinct.xyz/docs/sp1/prover-network/private-proving).

### Where FHE would add a useful guarantee

FHE lets a service calculate over encrypted values without decrypting them during the calculation. A possible future LemmaX use is combining authorized encrypted outcome counts across companies. It could help when LemmaX must compute with data it is forbidden to read.

Encrypted record storage alone does not need FHE. The company's local calculation over its own data also does not need it. FHE does not authenticate a fabricated measurement, prevent selective reporting, or automatically prove a remote integration succeeded.

The current Zama architecture uses offchain FHE coprocessors and threshold-MPC key management. The host chain emits computation requests; it does not perform the expensive FHE work natively. This adds computation, service availability, access-control, and key-management dependencies. [Zama coprocessor](https://docs.zama.org/protocol/protocol/overview/coprocessor), [Zama KMS](https://docs.zama.org/protocol/protocol/overview/kms).

The checked OpenZeppelin integration documentation lists Ethereum mainnet and Sepolia where the FHE infrastructure is deployed. It does not establish a supported Monad deployment. EVM compatibility alone cannot supply the missing coprocessors and key-management network. Some Zama configuration/tutorial pages still describe Sepolia-only support, so concrete deployment addresses and access must be verified rather than inferred from marketing or older tutorials. [OpenZeppelin supported networks](https://docs.openzeppelin.com/relayer/zama-fhevm#supported-networks), [Zama configuration](https://docs.zama.org/protocol/solidity-guides/smart-contract).

**Recommendation:** keep FHE outside the current build. Revisit it only after identifying an encrypted computation that local calculation or ordinary encryption cannot satisfy, and verifying an accessible service plus measured total cost. No claim of a universally cheapest or fastest cryptographic backend has been established.

### Cost measurement if a proof is later selected

Measure the exact statement on the target client hardware and Monad verifier:

```text
incremental proof cost = witness preparation
                      + proving and optional wrapping
                      + submission calldata
                      + verification transaction fee
                      + prover/service operations
                      + setup and maintenance allocation
```

Measure cold and warm proving latency, peak memory, proof size, deployment size, actual charged transaction gas, invalid-proof rejection, and replay rejection. A batching design may reduce verification cost per record, but requires enough records and accepts additional delay. No such measurements have been run here.

## 8. What Monad contributes

Monad supplies public financial enforcement and a common commitment timeline. Documented EVM compatibility allows use of familiar Solidity tools. Fast blocks make funded attempts and settlement status responsive; parallel execution helps transaction throughput, rather than running private company integration tests. [Monad developer summary](https://docs.monad.xyz/developer-essentials/summary).

Current documentation specifies 300 ms blocks and 600 ms consensus finality. Significant offchain financial effects should wait for the documented `Verified` stage, which follows `Finalized` by three blocks. LemmaX's fund tool returns at `Verified` before any work starts. [Monad timing guidance](https://docs.monad.xyz/developer-essentials/summary#timing-considerations).

Ethereum-compatible cryptographic precompiles support appropriate Solidity verifier designs. Native P256 verification supports passkey signatures if that route is selected. These primitives do not create native encrypted storage, FHE computation, or private repository execution. [Monad precompiles](https://docs.monad.xyz/developer-essentials/precompiles).

Current tooling guidance names Foundry 1.8+ and Viem 2.40+. Monad charges the submitted gas limit, so Ethereum verifier gas figures cannot be treated as the exact Monad bill. Estimate and measure the actual transaction, including any state growth, on the chosen network. [Monad tooling and gas guidance](https://docs.monad.xyz/developer-essentials/summary).

**Blob availability:** Monad explicitly does not support type-3 EIP-4844 transactions. Its KZG point-evaluation precompile does not supply blob storage or authenticate Ethereum publication. [Monad transaction support](https://docs.monad.xyz/developer-essentials/summary#transaction-types), [Monad KZG precompile](https://docs.monad.xyz/developer-essentials/precompiles#kzg-commitment).

The proposed initial evidence path remains durable company-controlled storage. Optional Ethereum blob publication could later distribute authorized batches during Ethereum's approximately 18-day protocol serving window, with a separate archive for continued retrieval. This would add another chain, costs, and an explicit inclusion/finality trust boundary. Keep it independent of settlement unless a future purchased service requires publication under an agreed policy. No blob route has been adopted. [Ethereum data availability](https://ethereum.org/en/developers/docs/data-availability/), [LemmaX blob research](research/LemmaX-Blob-Research.md).

The architecture is portable to other EVM networks. Monad's performance, primitives and agent ecosystem motivate the deployment choice; no unique confidentiality property is attributed to the chain. Monad's gas and reserve rules also shaped contract version 3, which pays agents inside settlement so they never need MON. [Trust loop](Trust-Loop.md#1-the-monad-problem-stranded-agent-funds).

## 9. Integrations

Each integration decides something in the payment path:

- **Envio:** the public auditor. It indexes settlements, rebuilds who was paid what and records rule verdicts, which the buyer's guard reads before the wallet signs. [Envio in the trust loop](Trust-Loop.md#envio-the-public-auditor).
- **Privy:** the buyer's server wallet. Its policy signs only quotes the buyer's guard approved. [Privy in the trust loop](Trust-Loop.md#privy-the-buyers-mandate).
- **ERC-8004:** identities for four LemmaX agents and feedback built from settled attempts only (section 4).

The hosted Envio auditor is live on Monad Testnet and gates the page's purchases ([check](../verification/auditor-check-testnet.json)). The Privy policy passed its kill test ([report](../verification/privy-kill-test.json)), and the four ERC-8004 agents are registered with feedback published from settled attempts ([record](../verification/reputation-testnet.json)). The buyer's own Privy wallet is not created yet. [Status](../README.md#verify-it-yourself).

## 10. Scale evidence

The build excludes custom model training, generalized proof of repository integration, FHE deployment, a new liquidity pool, and a universal asset marketplace.

### Minimum evidence of scale readiness

The first release should support a bounded statement: the implemented path met declared correctness, latency, and cost requirements at specified data sizes and arrival rates on recorded hardware. A successful small run alone cannot establish production capacity. The following is a proposed minimal protocol, not a completed result or a selected service-level promise.

**Assessment load and growth:** use the actual HTTP/MCP assessment path with persistence and authorization checks. Generate labeled synthetic catalog and evidence volumes for performance testing only. A feasible initial sweep is 100, 1,000, and 10,000 offers, with a separate 1,000 versus 100,000 stored-case comparison while holding the eligible candidate set fixed. Increase request arrivals through 1, 10, and 50 requests/second. These values are proposed test levels. Freeze the hardware, allowed cost, p95 latency, and error thresholds before execution. Record achieved throughput, failed and dropped requests, CPU/RAM, database work, cache behavior, and cost per successful assessment. A sweep plus a five-minute sustained run at the intended operating point is a modest first artifact, not a long-term stability test.

Use a client with arrivals independent of response completion, such as k6's arrival-rate executor. A response-dependent client can reduce offered load as the server slows and hide overload. Count dropped scheduled work as unmet load rather than excluding it from the result. A local load generator must have sufficient headroom or run separately. [k6 workload models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/), [arrival-rate executor](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).

**Evidence correctness and evaluator capacity:** compare API output with independently calculated reference vectors, not just HTTP status. Use a held-out case split for quality claims, with the relevant domain limitations. Add evidence while serving queries, replay a case, change an offer/profile version, and exercise authorization and cache invalidation. Verify that duplicate/correlated units do not inflate independent outcome counts, new evidence has a traceable snapshot, and private tenant contexts do not share unauthorized results. Synthetic volume establishes computational behavior only; it does not establish additional observations or statistical confidence. Execute a bounded batch through the actual evaluator, recording cases/second, queue delay, inference/runtime cost, and failures. Record hosted quota or local hardware limits where applicable. Directory throughput alone cannot establish evaluator capacity or service contribution margin.

**Settlement under retries and contention:** exercise one actual commitment/evaluator/settlement flow on Monad and locally test repeated submissions, racing terminal outcomes, invalid authorization, interrupted clients, and duplicate indexer delivery. Each attempt must have at most one effective terminal allocation; total credits cannot exceed its funded amount; reconciliation must tolerate replay. Record transactions, gas/cost, observed confirmation time, and indexer lag. A handful of testnet transactions validates the implemented path, not Monad-wide capacity or production RPC limits.

Keep the query path separate from evidence-producing work: assessments read versioned admitted statistics and quotes, while evaluators execute cases asynchronously. Under that design, more historical case rows should not require replaying every row for each query. Cohort selection, deduplication, materialization, numerical precision, and freshness still need measurement. Keep per-attempt public record contents bounded, with detailed evidence offchain.

The review artifact should contain reproducible scripts, code/data/configuration hashes, hardware and test duration, achieved rates, latency/error/cost results, correctness/failure checks, and observed limits. A signed manifest or commitment can bind those artifacts to a version; it authenticates the statement or detects changes, rather than proving honest execution. No ZK proof generation is required for this minimum evidence package. So far the evidence covers the paired SciFact benchmark and its metric arithmetic, a bounded local MCP probe of 200 replays, and the settlement checks. None of the scale protocol above has been run.

## 11. Open decisions and verification status

We favor sellable connectors and MCP tools, and model assets can be hosted inference access or downloadable weights and adapters. These categories can overlap: a connector can expose a model capability through MCP. The demonstration implements one path, retrieval connectors over a public corpus served through MCP.

The measurement unit is a bounded task case evaluated against a common acceptance target, with versioned benchmark batches for consistent testing and versioned capability offers as commercial listings. An entire model, connector, or MCP server can contain multiple capabilities. A single tool name or valid output schema does not establish task success. [MCP tool definitions and output schemas](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

The public benchmark follows the evidence-admission policy proposed in the [math/API research note](research/LemmaX-Math-and-API.md#proposed-mvp-evidence-admission-policy): a frozen benchmark, exact offer and profile versions, and complete reporting. Its illustrative forecast uses one representative query per correlated group. Public task-quality metrics, actual connector/deployment checks, and whole-attempt acceptance outcomes remain distinct evidence types. Admission of private company evidence is still open. The evaluator's access boundary then follows the evidence needed: company-controlled CI, an independent evaluator in the company environment, or an approved external service receiving selected evidence. All can be company-approved; they have different disclosure and trust consequences.

Before customer use, we still need to settle the purchased right for each customer offer and the evidence its acceptance policy requires. Funding parties must accept a real evaluator, and disputes and record retention need rules. No independent partner is lined up yet. Internal use of our projects is integration evidence, while another team's use remains a separate validation target. The commercial attempt, probability event, and refund event must use the same unit; benchmark-query success cannot substitute for integration or license acceptance. The [build readiness and reuse review](research/LemmaX-Build-Readiness-and-Reuse.md) records how the two earlier repositories informed this build.

External sources were checked during research. Where provider pages were unavailable or disagreed about deployments, the limits are stated above.

Built and checked since this design was written: two retrieval connectors with a paired benchmark, the assessment library, the MCP server, contract versions 2 and 3, and the trust loop. [Evidence guide](README.md#check-a-claim-against-its-record). None of these checks tests company adoption. No economic validation or protection against all inference from public payment metadata is established.

## Implemented attempt and settlement slice

Private AES-GCM record envelopes, randomized commitments, EIP-712 quotes/receipts and a USDC Solidity settlement contract are implemented; the first prototype used the native asset. We refund the full locked amount after the settlement deadline if no valid verdict is accepted, so a silent checker never costs the buyer anything. Local Monad execution and fork checks cover both outcomes, timeout, authority, replay protection, withdrawals and automatic payouts. Contract version 2 ran three live attempts on Monad Testnet, and contract version 3 is deployed there. The default public MCP server stays read-only. Live company approval, customer eligibility and disputes, and persistent key custody remain open. [Contract and verification](Attempt-and-Settlement.md). Network profiles, confirmation stages, gas policy, reconciliation and the deployment path are in [the Monad settlement path](Monad-Settlement-Path.md).
