# LemmaX: EIP-4844 blobs, Monad, and evidence storage

This note extends the [LemmaX architecture](LemmaX-Architecture.md) and [math/API specification](LemmaX-Math-and-API.md). It records verified capabilities and proposed integration choices. No blob transactions, contracts, storage accounts, bridges, or deployments were created.

**Recommendation for discussion:** keep the four-day MVP on Monad with private, durable evidence storage and signed evaluator outcomes. Consider Ethereum blobs later for publishing authorized batches that other participants need to retrieve and replay. Native blob storage on Monad is currently unavailable. Adding the optional publication route is not an adopted product decision.

## 1. What blobs actually provide

EIP-4844 introduces Ethereum type-3 transactions carrying blobs. Each blob occupies 131,072 bytes, or 128 KiB. Blob bytes are outside EVM-readable contract state; execution can refer to their commitments. Transactions pay execution fees plus a separate blob fee. A blob is therefore a data-availability mechanism, rather than an ordinary smart-contract database. [EIP-4844 specification](https://eips.ethereum.org/EIPS/eip-4844).

Ethereum's protocol provides a minimum serving window of approximately 18 days. Historical data can survive in independent archives, but long-term retrieval needs a separate retention arrangement. Expiry of the protocol obligation does not erase every copy. [Ethereum data-availability documentation](https://ethereum.org/en/developers/docs/data-availability/).

Three separate properties matter for LemmaX:

- **Integrity:** retrieved bytes match the committed bytes.
- **Availability:** a participant can obtain those bytes during the promised period.
- **Truth:** the evaluator actually checked the agreed integration acceptance criteria.

Blob publication helps with the first two. It does not establish the third, or establish that the published sample includes every eligible success and failure. A permanent commitment can remain useful even after the corresponding bytes become unavailable.

## 2. Monad compatibility

Monad explicitly lists transaction type 3, EIP-4844, as unsupported. Supporting Ethereum opcodes and Solidity tooling does not override this transaction-level restriction. An Ethereum blob publisher cannot simply switch its RPC endpoint to Monad. [Monad deployment summary](https://docs.monad.xyz/developer-essentials/summary#transaction-types).

Monad does support the KZG point-evaluation precompile at `0x0a`, documented at 200,000 gas. This verifies a polynomial-opening relationship for a supplied commitment. It supplies neither blob storage nor Ethereum consensus verification. [Monad precompiles](https://docs.monad.xyz/developer-essentials/precompiles#kzg-commitment).

**Security consequence inferred from those interfaces:** a valid KZG opening on Monad does not prove that the associated blob was published in a finalized Ethereum block. An unpublished polynomial can also have valid openings. Supplying an Ethereum transaction hash or block hash is a reference, not an authenticated cross-chain observation.

If Ethereum publication eventually affects Monad contract behavior, LemmaX must explicitly choose how Ethereum inclusion and finality are authenticated. An approved attester fits the current evaluator trust model. An independently verified light client or suitable audited bridge would introduce a different implementation and trust boundary. No such integration is selected here.

If publication is later selected, the approved evaluator can check it offchain and issue a separately signed publication receipt bound to the attempt commitment. If publication becomes an acceptance criterion, the settlement verdict can attest that criterion as part of the overall outcome. The Monad contract would continue to trust that evaluator's signature. It would not gain independent Ethereum verification from this arrangement.

## 3. Developments beyond the original EIP

**PeerDAS**, delivered with Ethereum's Fusaka upgrade, uses distributed sampling and reconstruction to scale blob availability without requiring every node to download every blob. This improves Ethereum's publication capacity. It does not add permanent retention or make Monad accept blob transactions. [Ethereum Fusaka overview](https://ethereum.org/roadmap/fusaka/).

The Ethereum Foundation reported a target of 14 blobs and maximum of 21 per block after its parameter increases. The mainnet consensus configuration inspected for this research also schedules a maximum of 21. These are block limits; PeerDAS sets a separate maximum of six blobs per transaction. [Ethereum Foundation checkpoint](https://blog.ethereum.org/2026/01/20/checkpoint-8), [mainnet configuration](https://raw.githubusercontent.com/ethereum/consensus-specs/master/configs/mainnet.yaml), [EIP-7594](https://eips.ethereum.org/EIPS/eip-7594).

PeerDAS also changes the network transaction wrapper and proof format. An older blob tutorial is insufficient evidence that an SDK, signing service, and RPC provider support the current network. Pin and verify their actual versions before implementing a publisher. [EIP-7594 networking specification](https://eips.ethereum.org/EIPS/eip-7594).

EIP-7918 links blob-fee adjustment to execution costs through a reserve mechanism. Forecasting all future publications at the historical one-wei blob-gas minimum would be unreliable. Actual fees still depend on the publishing block. [EIP-7918](https://eips.ethereum.org/EIPS/eip-7918).

These developments make Ethereum blobs more practical for bulk publication. They do not resolve LemmaX's confidentiality, evaluator honesty, or archival responsibilities.

## 4. Where blobs fit in LemmaX

### Proposed MVP baseline

Keep company records, acceptance evidence, and private adaptations in company-controlled storage. Give the approved evaluator the access needed for the agreed checks. Retain the randomized attempt commitment and settlement outcome on Monad, along with the necessary financial state already described in the architecture.

Use a versioned evidence bundle whose digest and signed evaluator receipt can be verified after retrieval. Archive it according to the company's retention and dispute policy. The database serves authorized directory queries and comparable-outcome statistics. This workflow requires no Ethereum publication, inference model, or cross-chain bridge.

### Optional Ethereum publication

The strongest candidate is a **public directory evidence snapshot** containing authorized outcome definitions, cohort summaries, admissible receipts where disclosure is permitted, and the data needed to reproduce an assessment. Another candidate is a company-authorized encrypted batch for designated readers. The first makes portable directory evidence easier to inspect; the second requires an explicit reason to publish ciphertext publicly rather than share it through private storage.

A proposed publisher would:

1. Collect authorized records and bind them to versioned outcome definitions and evaluator receipts. A private adaptation becomes no public catalog entry merely because an attempt was evaluated.
2. Produce a canonical, length-delimited bundle with a manifest and digest. Include randomized record commitments where record linkage requires them. Compress before encryption when appropriate.
3. For private batches, encrypt on company-controlled infrastructure using authenticated encryption and retain keys under company policy. Keep private labels out of the public manifest.
4. Write the exact bundle to its durable archive first, then encode and publish a batch through an Ethereum blob transaction.
5. Record the Ethereum locator privately or in an authorized public snapshot. Confirm inclusion and the chosen finality policy, retrieve the published data independently, and verify it against the archived bundle.
6. Allow a reader to retrieve, decode, authenticate, and reproduce the permitted calculation. After the protocol serving window, use the archive and verify the same digest and signatures.

The archive contains the exact published bundle and encoding/version metadata needed for verification. An archive URL alone does not authenticate its contents or establish service continuity.

**Preserve the existing public-record boundary:** do not automatically put company names, resource IDs, cohort membership, archive URLs, or Ethereum batch locators into Monad events. Optional locators can remain in the private evidence record. A new public batch anchor would require a deliberate disclosure decision.

Settlement should remain independent of optional batch publication. If a future purchased service promises publication, its acceptance policy must define the publication deadline, finality rule, archival obligation, failure treatment, and payer before funding.

### Cases with little benefit

A single 32-byte attempt commitment does not require a blob. Searchable directory fields belong in the query database. Repositories, model weights, and long-lived evidence still need persistent storage. A rarely filled batch also incurs an Ethereum execution transaction and operational work even when its blob fee is low.

Blobs become worth considering when multiple participants need network-backed access to a sufficiently large authorized dataset. They do not become necessary merely because the application settles on a blockchain.

## 5. Confidentiality and verification boundaries

Blob data is publicly retrievable. Private publication therefore requires encryption before transmission. Ethereum does not provide company key custody, revocable reader access, or confidential processing of the blob contents.

Public ciphertext can be copied indefinitely. Removing a company's key or archive access cannot recall copies already held by readers. Publishing private evidence requires an explicit assessment of that exposure, even if the ciphertext remains cryptographically protected.

Public sender addresses, batch size, timing, and disclosed identifiers can still reveal relationships. Randomized commitments, private manifests, appropriately chosen batch sizes, and padding can reduce particular leaks. They do not remove ordinary transaction metadata or guarantee anonymity.

KZG commitments are not a privacy layer and do not substitute for the salted commitments in the architecture. ZK, zkML, and FHE remain separate optional mechanisms. Publishing encrypted bytes needs conventional encryption; it does not require a new ZK circuit or FHE network.

For assessment calculations, storage provenance must remain separate from statistical evidence. A published success count is not automatically an admissible sample. Preserve evaluator authorization, cohort compatibility, duplicate handling, reporting coverage, and the common outcome definition from the math specification. Blob-backed evidence does not automatically increase `P_outcome` or make its estimates calibrated.

## 6. Cost and batching mathematics

For Ethereum publication transaction `j`, define:

```text
publication_cost_wei_j = execution_gas_used_j * effective_execution_price_wei_j
                         + blobs_j * 131072 * blob_base_fee_wei_j

publication_cost_USDC = sum(publication_cost_wei_j) / 10^18
                        * ETH_price_in_USDC
```

Use actual paid prices when reconciling. Fee caps are maximum authorizations, not the prices necessarily paid. Include retries and failed submissions in operating-cost estimates; execution reversion does not refund the blob fee. The fee expression follows EIP-4844's separate execution and blob accounting. [EIP-4844 gas accounting](https://eips.ethereum.org/EIPS/eip-4844#gas-accounting).

Application payload capacity is smaller than the physical blob size. Viem's current `toBlobs` implementation puts 31 data bytes into each 32-byte field element and appends a terminator. **Derived from that codec:** one blob can hold at most 126,975 application bytes. A 2,048-byte record allows at most 61 records before manifest, encryption, and framing overhead. This is an encoding example, not measured LemmaX evidence size. [Viem encoder source](https://github.com/wevm/viem/blob/main/src/utils/blob/toBlobs.ts), [Viem blob constants](https://github.com/wevm/viem/blob/main/src/constants/blob.ts).

For `n` paid attempts sharing a batch, an equal-allocation example is:

```text
incremental_DA_cost_per_attempt = (
    Ethereum_publication_cost
    + optional_Monad_anchor_cost
    + incremental_archive_cost
    + retrieval_and_attester_cost
    + publisher_operations_allocation
) / n
```

All terms must use the same currency and planning horizon. Archive costs already present in the baseline must not be counted twice. If a directory snapshot serves many subsequent queries rather than one record per paid attempt, choose an allocation reflecting that usage instead of mechanically dividing by receipt count.

If LemmaX pays this incremental cost without charging an extra fee:

```text
m_with_blobs = m_existing - incremental_DA_cost_per_attempt
```

If it charges an incremental gross publication fee `F_DA`, add that fee once and subtract the actual incremental operating cost once. This preserves the existing contribution equation and affordability gate.

For a chosen batch whose fixed cost remains `C_fixed`, variable cost per attempt is `c_variable`, and equally allocated attempts have margin headroom `h = m_existing - m_min`:

```text
n_min = ceil(C_fixed / (h - c_variable))
```

This applies only when `h > c_variable`, no extra fee is charged, and the assumed capacity and cost remain valid at `n_min`. If the required count exceeds that batch's capacity, adding blobs changes the calculation. Do not silently assume the extra records still fit at the original price.

Buyer-paid publication changes `C_reuse` only through actual additional expenditure or valued delay. Put a directly paid chain fee in `G`, or a LemmaX-billed publication service in `T`, without counting both. If LemmaX absorbs the expense, its margin falls without automatically increasing the buyer's bill. Keeping settlement independent avoids making the buyer wait for a batch merely to receive a verdict.

For a storage benchmark, Cloudflare lists Standard R2 at $0.015 per GB-month, with a monthly allowance of 10 GB-month, one million Class A operations, and ten million Class B operations. Egress is free under the documented pricing. Those allowances do not cover the whole application, evaluator, or database. This is an optional comparison, not a hosting migration; recheck prices before quoting. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

For a small prototype whose evidence fits those allowances, conventional storage can have zero marginal storage charges. Ethereum publication adds transaction costs. Blobs should therefore be justified by their availability/replay benefit, rather than a blanket claim that they are the cheapest permanent storage.

## 7. Minimal tools and API changes

**Existing stack:** retain the current deterministic TypeScript service, HTTP/MCP interface, database, and Monad client. Evidence storage is an adapter, not an agent making a plan.

**Optional publisher:** Viem documents `toBlobs`, KZG setup, and sending blob transactions. A compatible KZG implementation and trusted setup are required. Use a provider that supports publication and a consensus-data source or reconstruction service for retrieval; an execution RPC alone does not establish that it serves blob bytes. Current PeerDAS wrapper support must be verified for the exact SDK/provider combination. [Viem blob-transaction guide](https://github.com/wevm/viem/blob/main/site/pages/docs/guides/blob-transactions.md).

**Optional inspection:** Blobscan indexes Ethereum blob transactions and documents storage-provider integrations. It can help inspect or retrieve publication records, but running its full indexer and storage infrastructure is unnecessary for the initial product. A third-party explorer is not itself an agreed long-term retention guarantee. [Blobscan documentation](https://docs.blobscan.com/).

The proposed evidence adapter would retain these fields offchain:

- For every bundle: storage kind, payload digest, codec version, authorization/encryption policy reference, and retention policy reference.
- For an Ethereum publication: chain ID, transaction hash, block hash, blob index or index range, versioned hash or hashes, and inclusion/finality verification method.
- For continued retrieval: archive references and the exact archived bundle's digest.

These are proposed metadata, not a finalized JSON schema. Private references are accessible only under company policy. `POST /v1/assessments` and `lemma_assess` continue using the same outcome and cost equations. Neither requires a blob locator in its public response. HTTP outcome ingestion continues to require authorized evaluator evidence; it does not accept arbitrary public blob contents as settled truth.

## 8. Four-day recommendation and remaining decision

Build the deterministic assessment and private evidence path, then demonstrate funded commitment and signed settlement on Monad. Portable evidence bundles and reproducible calculations already support the trust/provenance direction without a second chain.

If the core workflow is complete and a publication benefit is established, a later optional experiment can publish a synthetic, explicitly public batch on Ethereum Sepolia, retrieve it independently, and compare costs with ordinary archived storage. That experiment would not establish production affordability, confidentiality, or hackathon eligibility.

Before adopting blobs, choose what needs network-backed availability: a public directory snapshot, an authorized private batch, or neither. Then measure encoded payload size, fill rate, publication fee, finality/retrieval latency, provider compatibility, archive recovery, and actual margin impact. The common acceptance outcome for the first resource family remains the next product decision.

**Verification status:** primary specifications, provider documentation, and current source/configuration were reviewed. The codec capacity and batching arithmetic were derived separately. No live fee quote, publication benchmark, SDK compatibility test, cross-chain proof, or deployed integration was performed. This note does not establish blob support on Monad or select a storage provider.
