# LemmaX on Monad: architecture, deployment path and plan

Package version 0.5.0. Settlement now uses Circle USDC on Monad. A buyer funds an attempt with one EIP-3009 authorization bound to the signed quote, and the contract stores only the quote digest. Earlier slices added network profiles, a gas and confirmation policy, a typed client, event reconciliation and a dry-run-first deployment script. No contract is deployed to Monad Testnet or mainnet, and no wallet credentials or testnet funds have been used. [Attempt and settlement contract](Attempt-and-Settlement.md).

## 1. Decisions recorded

- **Asset.** Quotes and payments use USDC atomic units (six decimals), so no price oracle is needed. The contract is fixed to one token at deployment. On testnet and mainnet that token is Circle USDC. Native MON settlement is removed.
- **Keys.** The quote issuer and the evaluator use separate keys, so the two authorities are distinct onchain.
- **Network.** The live demonstration targets Monad Testnet.
- **Offer prices.** Both retrieval offers carry the same principal.
- **Cost basis.** Demonstration prices reflect published reference prices and measured costs, not invented figures. Section 6 proposes values for confirmation.
- **Deadlines.** Two deadline profiles: a standard profile, and a short profile that makes the timeout refund demonstrable.
- **LemmaX revenue.** LemmaX earns only the execution charge. There is no onchain success share, so the three payees (connector, executor, evaluator) are unchanged.

## 2. Current architecture

Two paths are implemented. They are not yet joined by a purchase path.

**Directory path, public and read-only.** The frozen SciFact report feeds two connectors (`src/retrieval.mjs`), the decision core (`src/beta.mjs`, `src/assessment.mjs`, `src/billing.mjs`), the public directory (`src/directory.mjs`) and the stdio MCP server (`src/mcp.mjs`). It returns observed hit rates and assessments, redacts operator contribution and reports `fundable: false`. [Retrieval and MCP](Retrieval-and-MCP.md).

**Financial path, local Monad execution.** Private records, commitments, EIP-712 quotes and receipts, and the buyer's EIP-3009 funding authorization (`src/attempt.mjs`) pass through the Monad client (`src/monad.mjs`, `src/settlement.mjs`) to `AttemptSettlement.sol`. The reconciler (`src/reconcile.mjs`) matches the contract's events with the private quotes and receipts. `scripts/deploy-settlement.mjs` deploys the contract.

**Missing join.** The MCP server cannot yet issue a fundable quote, collect the buyer's authorization or report settlement status. Those steps are the Phase 3 purchase path.

The target lifecycle for one attempt:

```text
1  agent        -> directory    lemma_assess (implemented)
2  directory    -> agent        pOutcome, C_reuse, rank
3  agent        -> directory    lemma_quote_attempt (planned)
4  directory    -> agent        issuer-signed quote, sealed private record
5  buyer wallet                 signs EIP-3009 authorization, nonce = quote digest
6  relayer      -> Monad        fund(quote, issuer signature, buyer authorization)
7  Monad        -> executor     AttemptCommitted, wait for Verified
8  executor and evaluator       run connector, check privately, sign receipt
9  evaluator    -> Monad        settle(quote, receipt, signature)
10 Monad        -> reconciler   AttemptOutcome, credits
11 reconciler   -> agent        lemma_attempt_status (planned)
12 owner        -> Monad        withdraw(amount, destination)
   no valid receipt by settleBy: anyone calls refundTimeout(quote) for a full refund
```

Steps 1, 2 and 5 to 12, apart from the planned status tool, run today against local Monad execution and a fork of Monad Testnet. Step 8 exists as the signed example in `examples/attempt.mjs`, not as a service. The public and private boundary is unchanged from the [architecture](LemmaX-Architecture.md#3-what-is-public-on-monad).

## 3. Monad behaviour that shapes the implementation

These properties were checked against official documentation and live public RPC responses. Recheck them before a deployment, since network parameters change through upgrades.

- **The gas limit is charged.** Monad charges the gas limit set in the transaction rather than the gas used. A transaction that reverts after inclusion still pays its full limit. [Gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing).
- **Reserve balance.** Asynchronous execution reverts, while still charging gas, a native-value spend that leaves an EOA below the lower of its starting balance and 10 MON. USDC funding sends no native value, so the buyer needs no MON at all; the relaying wallets need MON only for gas. [Reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance).
- **Commitment stages.** Blocks move through Proposed, Voted, Finalized and Verified. The RPC `latest`, `safe` and `finalized` tags map to the first three. Verified is the finalized head minus three blocks, the execution delay. Monad recommends waiting for Verified before significant offchain financial effects. [Block states](https://docs.monad.xyz/monad-arch/consensus/block-states), [developer summary](https://docs.monad.xyz/developer-essentials/summary).
- **Timestamps.** Blocks arrive about every 300 ms but carry whole-second timestamps, so several blocks share one second. Deadlines need margin for that and for clock skew.
- **Storage pricing.** Cold storage is charged per 128-slot page and a new storage slot carries a state-growth charge. A token transfer to an address with no balance pays that charge. [Opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing).
- **Networks and USDC.** Testnet is chain 10143 and mainnet chain 143. Circle USDC is `0x534b2f3A21130d7a60830c2Df862319e593943A3` on testnet and `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` on mainnet. Testnet USDC reports name `USDC`, version `2` and six decimals, and implements EIP-2612 and EIP-3009, including the `bytes` signature form that accepts ERC-1271 smart-wallet signatures. [Network information](https://docs.monad.xyz/developer-essentials/network-information), [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
- **Testnet funds.** Circle's public faucet gives 10 testnet USDC per address per 24 hours on Monad Testnet. [Circle faucet](https://developers.circle.com/w3s/developer-console-faucet).
- **Toolchain.** Compilation for Monad requires the `osaka` EVM target. Foundry 1.8 or newer runs Monad execution with `--network monad`. MonadVision verifies source through Sourcify. [Hardhat guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/hardhat), [Foundry guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/foundry), [Foundry verification](https://docs.monad.xyz/guides/verify-smart-contract/foundry).

## 4. Implemented

### Settlement contract version 2

The contract takes an approved issuer and the settlement token at construction; both are immutable. The EIP-712 domain is `LemmaXAttemptSettlement` version `2`, so version 1 signatures cannot be replayed against it. Quote and receipt types, the settlement policy hash and the allocations are unchanged.

`fund(quote, issuerSignature, buyerAuthorization)` checks the quote and the issuer signature, records the attempt, and calls the token's `receiveWithAuthorization` for the exact funding total. The buyer's EIP-3009 authorization uses the domain-bound quote digest as its nonce. One buyer signature therefore consents to every quote term (payees, evaluator, caps and deadlines), the token refuses a second use of the same quote, and any wallet can relay the funding transaction. Only the payee contract can submit a receive authorization, so the transfer cannot be front-run around the escrow. The contract confirms that its token balance rose by exactly the funding total.

Storage holds only the quote digest, funding time and state. `settle(quote, receipt, signature)` and `refundTimeout(quote)` take the quote back as calldata and reject it unless it matches the stored digest, so payees cannot be swapped after funding. `attemptInfo(attemptId)` returns the stored digest, funding time and state for reconciliation. `withdraw` transfers USDC to a destination chosen by the credit owner. It rejects the contract itself as a destination. If the token refuses the transfer, for example to a blocked address, the call reverts and the credit remains. Tokens sent directly to the contract never become spendable credit.

### Network profiles and confirmation

`connectMonad({ network, rpcUrl, allowMainnet })` accepts only `local`, `testnet` or `mainnet`, requires an explicit HTTP(S) RPC URL, refuses mainnet without explicit permission, and compares the chain ID reported by the RPC with the profile. Each profile names its USDC address; the local profile has none, since local checks deploy a mock.

`waitForStage(client, inclusion, stage, timing)` supports `included`, `finalized` and `verified`, then confirms that the inclusion block hash is still canonical. `gasLimitFor(estimate, headroomBps)` adds explicit headroom, bounded to 0 to 5000 basis points. Headroom is paid even when unused, so it should stay small.

### Settlement client

`createSettlementClient({ publicClient, address, gasHeadroomBps })` wraps `fund`, `settle`, `refundTimeout` and `withdraw`. Every write is estimated first, so a rejection returns a named reason without mining a reverted transaction: a contract error such as `InvalidQuote`, or the token's own message such as an invalid or expired authorization. `fundingAuthorization({ domain, quote, validAfter, validBefore })` reads the token's name and version and returns the typed data the buyer signs. The token rejects an authorization at `validBefore`, so a window that should cover the whole quote ends one second after `quoteExpiresAt`. Read helpers return attempt state and information, owner credit, the approved issuer, the token and the ledger.

### Reconciliation and deployment

`readSettlementLogs` and `reconcileAttempts` are unchanged in behaviour: chunked event reads, idempotent duplicate delivery, and checks of commitments, digests, receipts, states, allocations and solvency against the private records.

`scripts/deploy-settlement.mjs` defaults to a dry run. On testnet and mainnet it uses the profile's Circle USDC and refuses any other token; a local run names its token in `LEMMAX_SETTLEMENT_ASSET`. It refuses a token that does not report six decimals. After deployment it compares runtime code with the build (immutables masked) and checks the issuer, token and EIP-712 domain, then writes a manifest and a standard JSON input for Sourcify verification.

```sh
export LEMMAX_MONAD_NETWORK=testnet
export LEMMAX_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
export LEMMAX_QUOTE_ISSUER=0xApprovedQuoteIssuer
export LEMMAX_GAS_HEADROOM_BPS=1000
npm run deploy:settlement
```

Broadcasting additionally requires `LEMMAX_DEPLOY_BROADCAST=1`, `LEMMAX_DEPLOYER_KEY`, `LEMMAX_CONFIRMATION_STAGE` and `LEMMAX_DEPLOYMENT_OUTPUT` (an ignored directory). Mainnet requires `LEMMAX_ALLOW_MAINNET=1`. The key is never printed or written.

### Verification

The Node suite has 63 passing tests. They include the ABI drift check, the funding authorization's domain, nonce, window and chain guards, gas policy, stage waits, and reconciliation of matching, tampered and duplicated events.

`npm run settlement:check` deploys a local FiatToken test double (EIP-3009, ERC-1271-capable signature checks, a blocklist and a short-payment switch) and runs the full lifecycle under Monad execution. It passed 62 checks, including the following:

- Verified-stage deployment through the deployment function and the operator script.
- Funding relayed by the issuer wallet on the buyer's authorization.
- Rejection of an issuer signature from the wrong signer, modified terms, a wrong chain, a foreign asset, a mismatched or expired buyer authorization, and swapped payees at settlement.
- Exact allocations and the full timeout refund.
- Duplicate operations rejected.
- A blocked withdrawal destination keeps its credit; a short-paying token is rejected; directly sent tokens stay unallocated.
- Reconciliation of events with the private records.

[Local report](../verification/settlement-check.json).

`npm run settlement:fork-check` runs the same lifecycle on a local fork of Monad Testnet against Circle's deployed USDC. It mints buyer funds on the fork through an impersonated master minter, so nothing reaches the network and no funds are used. It confirmed that the client's signing domain equals the token's `DOMAIN_SEPARATOR` and that Circle's FiatToken accepts the buyer authorization. It passed 59 checks; the token-double behaviours are skipped. Set `LEMMAX_FORK_RPC_URL` to a testnet endpoint. [Fork report](../verification/settlement-fork-check.json).

Gas under Monad execution with 10% headroom, used and (limit charged):

| Operation | Version 1, native MON | Version 2, Circle USDC on fork |
| --- | ---: | ---: |
| Deploy | 1,745,774 (1,920,352) | 1,867,064 (2,053,771) |
| `fund` | 353,458 (391,199) | 282,450 (313,088) |
| `settle`, success | 188,124 (209,332) | 195,971 (217,961) |
| `settle`, eligible failure | 117,400 (131,535) | 125,368 (140,298) |
| `refundTimeout` | 87,323 (98,455) | 94,696 (106,565) |
| `withdraw` | 74,486 (84,332) | 145,896 (162,883) |

Funding now includes the token transfer and still costs about 20% less, because the quote is no longer stored. Settlement costs slightly more, because the quote is resupplied and hashed. A USDC withdrawal to an address without a balance pays Monad's state-growth charge for the new balance slot. These are local measurements of forked state, not testnet receipts.

## 5. Plan

**Phase 3: testnet purchase path.** Confirm the demonstration terms in section 6. Deploy to chain 10143 with the Circle USDC address and verify the source on MonadVision. Run the quote issuer and evaluator as small services with separate keys from the environment; the issuer also relays funding and the evaluator relays settlement. Add `lemma_quote_attempt` and `lemma_attempt_status` to an authenticated MCP transport. Run one success, one eligible failure and one timeout on testnet and publish the reconciliation report. Exit: three settled testnet attempts whose events reconcile with their private records.

**Phase 4: trust and identity.** Register the directory agent and evaluator in the ERC-8004 Identity Registry, which is deployed on Monad mainnet and testnet; the validation registry is still pending and remains outside the settlement path. Publish authorized feedback after settlement only under an explicit disclosure policy. Add Envio HyperIndex if a live status view needs more than the reconciler. Automate the withdrawal bar once its meaning is chosen. [Monad ERC-8004 guide](https://docs.monad.xyz/guides/erc-8004), [ERC-8004 contracts](https://github.com/erc-8004/erc-8004-contracts), [Envio supported networks](https://docs.envio.dev/docs/HyperIndex/supported-networks).

**Phase 5: evidence and submission.** Run the assessment scale protocol from the [architecture](LemmaX-Architecture.md#minimum-evidence-of-scale-readiness), extend the cost ledger with measured testnet gas, and prepare the technical demonstration.

## 6. Proposed demonstration terms

These values are proposals for confirmation. Each traces to a published reference price or a measurement. Reference prices and the MON price are snapshots and must be rechecked before use.

### Reference prices and measured costs

- **Hosted retrieval APIs.** These are published per-request prices for search APIs that return ranked sources. Exa Instant: $4 per 1,000. Tavily basic: $8 per 1,000. Brave Search API: $5 per 1,000. Perplexity Search API: $5 standard or $1 fast. Serper: $1. Linkup standard: $5. Parallel: $1 or $5. You.com: $5. The median of eleven verified services is **$0.005 per request**; the range is $0.001 to $0.008 without subscription-only plans. [Exa](https://exa.ai/pricing), [Tavily](https://www.tavily.com/pricing), [Brave](https://brave.com/search/api/), [Perplexity](https://docs.perplexity.ai/docs/getting-started/pricing), [Serper](https://serper.dev/), [Linkup](https://docs.linkup.so/pages/documentation/platform/pricing), [Parallel](https://parallel.ai/pricing), [You.com](https://you.com/pricing).
- **Search over your own data.** Google Vertex AI Search lists $1.50 per 1,000 queries (Standard) and $4.00 (Enterprise), with index storage billed separately. [Vertex AI Search pricing](https://cloud.google.com/generative-ai-app-builder/pricing).
- **Building blocks.** Cohere Rerank 4 Fast costs $2.00 per 1,000 searches of up to 100 documents. OpenAI `text-embedding-3-small` and Voyage `voyage-4-lite` cost $0.02 per million tokens. A Pinecone serverless query on a small namespace uses 0.25 read units, about $0.000004. [Cohere](https://cohere.com/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), [Voyage](https://docs.voyageai.com/docs/pricing), [Pinecone](https://docs.pinecone.io/guides/manage-cost/understanding-cost).
- **LLM reading.** Claude Haiku 5.5 lists $0.10 per million input tokens for prompts up to 100,000 tokens. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- **Compute.** BM25 and TF-IDF scoring measured 2.5 ms mean per query. On AWS Lambda arm64 ($0.0000133334 per GB-second, $0.20 per million requests, 1 ms billing) that is about $0.0000002 per query. [AWS price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json).
- **Monad gas.** The observed mainnet base fee sat at the 100 MON-gwei floor with a typical 2 MON-gwei tip; the MON price snapshot was $0.0248 (CoinGecko and CoinMarketCap). With the measured limits above, a funding relay costs 0.0319 MON, about $0.00079. A successful settlement relay costs 0.0222 MON, about $0.00055, and a failure settlement 0.0143 MON, about $0.00036. [CoinGecko](https://www.coingecko.com/en/coins/monad), [CoinMarketCap](https://coinmarketcap.com/currencies/monad/).

### Proposed tariff, equal for both offers

| Term | USDC | Atomic | Basis |
| --- | ---: | ---: | --- |
| Principal P | 0.005 | 5000 | Median hosted retrieval price per request |
| Execution charge e | 0.0015 | 1500 | Funding relay gas plus compute; breaks even up to MON at about $0.047 |
| Execution cap E | 0.002 | 2000 | Headroom over e |
| Evaluation charge v | 0.0008 | 800 | Settlement relay gas plus label check; breaks even up to MON at about $0.036 |
| Evaluation cap V | 0.001 | 1000 | Headroom over v |
| Funded total | 0.008 | 8000 | P + E + V |

Success credits the connector 0.005, the executor 0.0015 and the evaluator 0.0008, and returns 0.0007 to the buyer. Eligible failure returns 0.0057 to the buyer. Timeout returns 0.008. The execution charge is LemmaX's only revenue; its contribution at the snapshot is about $0.0007 per attempt. Without an oracle, charges are fixed per versioned terms and must be revised if MON moves toward the break-even price. One faucet allowance of 10 USDC covers 1,250 funded attempts.

### Buyer's direct alternative

`C_reuse` needs the buyer's cost of completing the same outcome without the purchase. Two benchmark-based alternatives bracket it for the 5,183-document corpus (about 1.94 million tokens):

- **Own retrieval pipeline: about $0.0024 per query.** Cohere rerank, query embedding and a vector query, plus one-time corpus embedding spread over the 100-query illustrative workload. Engineering time is excluded.
- **LLM reads the corpus: about $0.194 per query.** Claude Haiku 5.5 input in chunks under 100,000 tokens. Output tokens are excluded.

The assessment library with these inputs, the representative public cohort and a uniform prior gives:

| Buyer alternative | BM25 p, expected cost | TF-IDF p, expected cost | Expected saving |
| --- | --- | --- | --- |
| Own pipeline, 0.0024 | 0.743, 0.0066 | 0.763, 0.0067 | negative, about -0.004 |
| LLM reads corpus, 0.194 | 0.743, 0.0559 | 0.763, 0.0521 | positive, about 0.14 |

With equal prices, TF-IDF ranks first when the alternative is expensive. When the alternative costs less than the principal, buying is not worth it and the directory says so. At real prices, the fixed settlement overhead (e + v = 0.0023) is almost half the principal. Per-attempt onchain settlement suits attempts worth more than a few cents; batched settlement is the direction for sub-cent queries. Probabilities describe the public benchmark under the disclosed independence assumption, not calibrated customer outcomes.

### Deadline profiles

Measured work takes seconds: Verified arrives about 1.5 s after inclusion, scoring takes 2.5 ms on average, and an MCP round trip measured 46 ms at the 95th percentile. The windows below therefore cover agent and wallet response, polling and second-granularity timestamps, not compute.

| Profile | Funding window | Execute by | Settle by | Timeout refund available |
| --- | ---: | ---: | ---: | ---: |
| `demo-standard/v1` | 120 s | issue + 240 s | issue + 600 s | after 10 minutes |
| `demo-timeout/v1` | 60 s | issue + 120 s | issue + 180 s | after 3 minutes |

The buyer authorization window ends one second after the quote expires. The timeout profile is used once, with the evaluator withholding its receipt, so the full refund can be shown live.

## 7. Open decisions

1. **Confirm the section 6 terms**, including which buyer alternative the demonstration agent declares.
2. **Withdrawal bar.** Accumulated-credit trigger or retained working balance, and the minimum. [Paid unit](Paid-Unit.md#reserve-credit-and-agent-controlled-withdrawal).
3. **Indexer.** Proposal: keep the in-repo reconciler as the correctness check and add Envio only for a status view.
