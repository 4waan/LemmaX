# LemmaX on Monad: architecture, deployment path and plan

Package version 0.6.0. Settlement uses Circle USDC on Monad. A buyer funds an attempt with one EIP-3009 authorization bound to the signed quote, and the contract stores only the quote digest.

Contract version 3 is the current contract. It pays credit out automatically and is deployed on Monad Testnet at [`0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7`](https://testnet.monadvision.com/address/0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7) in transaction [0x42fee0335b](https://testnet.monadvision.com/tx/0x42fee0335b6324c2100eb96185ca3d0e5fb3157adb39ac6c6a6c87af0c1c9a59), with an exact Sourcify match. [Deployment record](../deployments/AttemptSettlement-v3.testnet.json). Version 2, at [`0xfb59487E973C883E3fe4301238D485f7B248fA7f`](https://testnet.monadvision.com/address/0xfb59487E973C883E3fe4301238D485f7B248fA7f), is the earlier live run. Its source is verified on MonadVision, and three demonstration attempts ran there through the MCP purchase tools. Nothing is deployed to mainnet. [Attempt and settlement contract](Attempt-and-Settlement.md).

## 1. Decisions recorded

- **Asset.** Quotes and payments use USDC atomic units (six decimals), so no price oracle is needed. The contract is fixed to one token at deployment. On testnet and mainnet that token is Circle USDC. Native MON settlement is removed.
- **Keys.** The quote issuer and the evaluator use separate keys, so the two authorities are distinct onchain.
- **Network.** LemmaX runs on Monad Testnet.
- **Offer prices.** Both retrieval offers carry the same principal.
- **Cost basis.** Version 1 prices use published reference prices and a recorded version 2 gas-cost snapshot. Version 3 payout gas changes that cost basis; section 6 separates the two.
- **Deadlines.** Two deadline profiles: a standard profile, and a short profile that makes the timeout refund demonstrable.
- **LemmaX revenue.** LemmaX earns only the execution charge. There is no onchain success share, so the three payees (connector, executor, evaluator) are unchanged.
- **Payouts.** Contract version 3 attempts an automatic payout once credit reaches the owner's bar (minimum 0.01 USDC). The relayer pays gas; refused transfers preserve credit. An owner needs MON to withdraw credit below the bar. A signed instruction can route payouts or raise the bar.
- **Funding feedback.** The fund tool streams Monad's commit states and returns at Verified.
- **Trust loop.** The Envio auditor and Privy mandate integrations connect to the buyer's guard, which fails closed on a stale index. The loop was rehearsed with a local auditor and wallet policy. The hosted Envio auditor is live on testnet and agrees with the local auditor on every contract version 3 attempt; live Privy enforcement and four ERC-8004 registrations remain pending. [Trust loop](Trust-Loop.md).
- **License.** MIT.

## 2. Current architecture

Two paths are implemented, and the purchase path joins them.

**Directory path, public and read-only.** The frozen SciFact report feeds two connectors (`src/retrieval.mjs`), the decision core (`src/beta.mjs`, `src/assessment.mjs`, `src/billing.mjs`), the public directory (`src/directory.mjs`) and the stdio MCP server (`src/mcp.mjs`). It returns observed hit rates and assessments, redacts operator contribution and reports `fundable: false`. [Retrieval and MCP](Retrieval-and-MCP.md).

**Financial path, local Monad execution.** Private records, commitments, EIP-712 quotes and receipts, and the buyer's EIP-3009 funding authorization (`src/attempt.mjs`) pass through the Monad client (`src/monad.mjs`, `src/settlement.mjs`) to `AttemptSettlement.sol`. The reconciler (`src/reconcile.mjs`) matches the contract's events with the private quotes and receipts. `scripts/deploy-settlement.mjs` deploys the contract.

**Join.** With operator keys configured, the MCP server issues fundable quotes, relays the buyer's authorization and reports attempt status (section 4).

The target lifecycle for one attempt:

```text
1  agent        -> directory    lemma_assess (implemented)
2  directory    -> agent        pOutcome, C_reuse, rank
3  agent        -> directory    lemma_quote_attempt
4  directory    -> agent        issuer-signed quote, sealed private record
5  buyer wallet                 signs EIP-3009 authorization, nonce = quote digest
6  relayer      -> Monad        fund(quote, issuer signature, buyer authorization)
7  Monad        -> executor     AttemptCommitted, wait for Verified
8  executor and evaluator       run connector, check privately, sign receipt
9  evaluator    -> Monad        settle(quote, receipt, signature)
10 Monad        -> reconciler   AttemptOutcome, credits
11 reconciler   -> agent        lemma_attempt_status
12 owner        -> Monad        withdraw(amount, destination)
   no valid receipt by settleBy: anyone calls refundTimeout(quote) for a full refund
```

Every step ran on Monad Testnet with contract version 2. Version 3 makes step 12 optional: credit at or above the owner's bar is paid inside the settlement or refund transaction, and `withdraw` remains for smaller balances. Version 3 payouts have run under local Monad execution, on a fork of Monad Testnet and on testnet, where settlements paid credit out automatically to the provider, the checker, LemmaX and an agent wallet that holds no MON ([record](../verification/live-runs-testnet.json)). Step 8 runs inside `lemma_deliver_attempt` when the operator sets `EVALUATOR_PRIVATE_KEY`, and inside the page server, not as a standing service. The public and private boundary is unchanged from the [architecture](LemmaX-Architecture.md#3-what-is-public-on-monad).

## 3. Monad behaviour that shapes the implementation

These properties were checked against official documentation and live public RPC responses. Recheck them before a deployment, since network parameters change through upgrades.

- **The gas limit is charged.** Monad charges the gas limit set in the transaction rather than the gas used. A transaction that reverts after inclusion still pays its full limit. [Gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing).
- **Reserve balance.** Monad constrains native MON spending and budgets gas across in-flight transactions. Certain undelegated accounts qualify for an emptying exception. This is not a blanket requirement for every USDC owner to hold 10 MON. USDC funding sends no native value; the buyer signs an authorization and the relayer pays MON gas. [Reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance).
- **Commitment stages.** Blocks move through Proposed, Voted, Finalized and Verified. The RPC `latest`, `safe` and `finalized` tags map to the first three. Verified is the finalized head minus three blocks, the execution delay. Monad recommends waiting for Verified before significant offchain financial effects. [Block states](https://docs.monad.xyz/monad-arch/consensus/block-states), [developer summary](https://docs.monad.xyz/developer-essentials/summary).
- **Timestamps.** Blocks arrive about every 300 ms but carry whole-second timestamps, so several blocks share one second. Deadlines need margin for that and for clock skew.
- **Storage pricing.** Cold storage is charged per 128-slot page and a new storage slot carries a state-growth charge. A token transfer to an address with no balance pays that charge. [Opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing).
- **Networks and USDC.** Testnet is chain 10143 and mainnet chain 143. Circle USDC is `0x534b2f3A21130d7a60830c2Df862319e593943A3` on testnet and `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` on mainnet. Testnet USDC reports name `USDC`, version `2` and six decimals, and implements EIP-2612 and EIP-3009, including the `bytes` signature form that accepts ERC-1271 smart-wallet signatures. [Network information](https://docs.monad.xyz/developer-essentials/network-information), [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
- **Testnet funds.** Circle's public faucet gives 10 testnet USDC per address per 24 hours on Monad Testnet. [Circle faucet](https://developers.circle.com/w3s/developer-console-faucet).
- **Toolchain.** Compilation for Monad requires the `osaka` EVM target. Foundry 1.8 or newer runs Monad execution with `--network monad`. MonadVision verifies source through Sourcify. [Hardhat guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/hardhat), [Foundry guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/foundry), [Foundry verification](https://docs.monad.xyz/guides/verify-smart-contract/foundry).

## 4. Implemented

This section describes version 2, which ran the live attempts. Version 3 keeps this design and signing domain. It adds automatic payouts, publishes each quote's public terms in an `AttemptTerms` event, and refuses an issuer that names itself evaluator. [Version 3 and the trust loop](Trust-Loop.md#1-the-monad-problem-stranded-agent-funds).

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

The Node suite (`npm test`) includes the ABI drift check, the funding authorization's domain, nonce, window and chain guards, gas policy, stage waits, and reconciliation of matching, tampered and duplicated events.

`npm run settlement:check` deploys a local FiatToken test double (EIP-3009, ERC-1271-capable signature checks, a blocklist and a short-payment switch) and runs the full lifecycle under Monad execution. Against contract version 3 it passes 80 checks, including the following:

- Verified-stage deployment through the deployment function and the operator script.
- Funding relayed by the issuer wallet on the buyer's authorization.
- Rejection of an issuer signature from the wrong signer, modified terms, a wrong chain, a foreign asset, a mismatched or expired buyer authorization, and swapped payees at settlement.
- Exact allocations and the full timeout refund.
- Duplicate operations rejected.
- A blocked withdrawal destination keeps its credit; a short-paying token is rejected; directly sent tokens stay unallocated.
- Reconciliation of events with the private records.
- Automatic payouts from the 0.01 USDC minimum, a refused payout deferred and retried by `sweep`, and signed payout instructions.

[Local report](../verification/settlement-check.json).

`npm run settlement:fork-check` runs the same lifecycle on a local fork of Monad Testnet against Circle's deployed USDC. It mints buyer funds on the fork through an impersonated master minter, so nothing reaches the network and no funds are used. It confirms that the client's signing domain equals the token's `DOMAIN_SEPARATOR` and that Circle's FiatToken accepts the buyer authorization. Against version 3 it passes 77 checks, including a payout deferred by Circle's own blacklist and retried by `sweep`; the token-double behaviours are skipped. Set `LEMMAX_FORK_RPC_URL` to a testnet endpoint. [Fork report](../verification/settlement-fork-check.json).

Gas under Monad execution with 10% headroom, used and (limit charged):

| Operation | Version 1, native MON | Version 2, Circle USDC on fork | Version 3, Circle USDC on fork |
| --- | ---: | ---: | ---: |
| Deploy | 1,745,774 (1,920,352) | 1,867,064 (2,053,771) | 2,478,676 (2,726,544) |
| `fund` | 353,458 (391,199) | 282,458 (313,097) | 290,801 (322,274) |
| `settle`, success | 188,124 (209,332) | 195,971 (217,961) | 230,858 (356,337) |
| `settle`, eligible failure | 117,400 (131,535) | 125,344 (140,271) | 142,834 (259,510) |
| `refundTimeout` | 87,323 (98,455) | 94,696 (106,565) | 103,530 (216,283) |
| `withdraw` | 74,486 (84,332) | 145,896 (162,883) | 145,896 (162,883) |

Version 2 funding includes the token transfer and still costs about 20% less than version 1, because the quote is no longer stored. Settlement costs slightly more, because the quote is resupplied and hashed. A USDC withdrawal to an address without a balance pays Monad's state-growth charge for the new balance slot. Version 3 adds a fixed 100,000 gas payout allowance to the settlement and refund limits, because the first USDC transfer to a fresh account costs more on Monad. These are local measurements of forked state, not testnet receipts. Version 1 figures come from the local report at commit `7d0c1f6`, version 2 from the fork report at commit `6dd532e`, and version 3 from the current [fork report](../verification/settlement-fork-check.json).

### Purchase path

`src/terms.mjs` holds the version 1 tariff and deadline profiles as versioned data (`lemmax-demo-terms/v1`) and parses operator caps exactly, without floating point. `createQuoteIssuer` builds the private record and quote, signs the quote with the issuer key and returns the typed data the buyer wallet signs. It refuses terms above `LEMMA_MAX_USDC_PER_RESOLUTION` and stops issuing when a chain day's issued total would pass `LEMMA_DAILY_USDC_CAP`. Every issued quote counts, funded or not, and the running total is reserved before signing so concurrent requests cannot overrun it. The issuer's counter lives in process memory and provides a `restore` method. The public page persists daily issued totals and restores them after a restart; other callers must provide their own persistence. `createEvaluator` opens the record, reruns the committed retrieval task, checks authorization, source version and output limit, judges relevance against the public labels and signs the receipt with the tariff's charges. A conformance failure stays unresolved, so that attempt ends in the full timeout refund.

The MCP server registers three purchase tools only when the operator supplies a purchase desk. `lemma_quote_attempt` returns the signed quote, the typed data for the buyer wallet, and the private record and salt for the buyer to keep. `lemma_fund_attempt` relays the buyer's signed authorization for a quote this desk issued and waits for the Verified stage. It refuses a quote within five seconds of expiry, an attempt that is already funded, and a second relay of the same quote while one is in flight, because a funding transaction mined after expiry still pays its whole gas limit. `lemma_attempt_status` reads onchain state. A rejection returns the reason from our validation, the contract or the token. Issued quotes live in process memory. The stdio transport runs under the operator's control; a remote transport needs authentication before it is exposed. Two further assessment scenarios price the demonstration terms against the declared buyer alternatives.

`npm run demo:testnet` runs a purchase sequence through those tools. The buyer agent assesses both alternatives, then a timeout attempt is funded first, a success and an eligible failure are settled by the evaluator, the timeout attempt is refunded after its settlement deadline, LemmaX withdraws its execution charges, and the events are reconciled. `LEMMAX_DEMO_TARGET=fork` rehearses on a local fork of Monad Testnet with fork-minted funds. `LEMMAX_DEMO_TARGET=testnet` reports balances, the gas budget, the operator caps and the chosen offer and cases only, unless `LEMMAX_DEMO_BROADCAST=1`. The offer is assessed and chosen before any chain access, so a stale or unranked assessment stops the run before anything is paid for. The rehearsal with the configured role keys and Circle's USDC passed: TF-IDF ranked first under the LLM-reads-corpus alternative, all three outcomes ended as planned, LemmaX withdrew 0.003 USDC and reconciliation reported no issues. [Rehearsal report](../verification/testnet-demo-fork.json).

### Live run on Monad Testnet

Contract version 2 was deployed by `DEPLOYER_PRIVATE_KEY` in transaction [0x5b25bc59ae](https://testnet.monadvision.com/tx/0x5b25bc59ae3e434d2b9f6b686eaa7c9a630697a0c8cd2d36118e2a4e4d446802). Its runtime matches the build with immutables masked, its issuer is the facilitator, its token is Circle USDC and its signing domain is version 2. Sourcify on MonadVision reports an exact match for both creation and runtime bytecode.

The sequence then ran against that contract through the MCP purchase tools, with the buyer agent declaring the LLM-reads-corpus alternative. The facilitator relayed every funding transaction and the evaluator relayed every settlement, so the buyer used no MON.

| Attempt | Case | Final state | Funding | Settlement or refund |
| --- | --- | --- | --- | --- |
| Timeout profile, evaluator withholds | 1012 | refunded in full | [0xffeb4190](https://testnet.monadvision.com/tx/0xffeb419092994c492a8bcc53adbb9ef1f80ca9a72c525ffd0032e63d09ecd85c) | [0x7b4078e7](https://testnet.monadvision.com/tx/0x7b4078e70ef7b8003d69cdd27f04d88edd6c925178b99b0f9d57f940c43a0ec2) |
| Success | 100 | settled, success | [0xd992b619](https://testnet.monadvision.com/tx/0xd992b619833cfde8ab9eb09727e7c005b99728ccde3e7279b287140cf562a658) | [0x28dea749](https://testnet.monadvision.com/tx/0x28dea749676021673024c96ac1c6ee17ad6356cbd6a5667abcb54c00acbb6ac4) |
| Eligible failure | 1 | settled, eligible failure | [0xacc329b5](https://testnet.monadvision.com/tx/0xacc329b5b4e6fcd64bcabca7251c05feada9b39aa260c81527686123bfbadafa) | [0xacd6d2f3](https://testnet.monadvision.com/tx/0xacd6d2f3652ab0b8a8be679851bdab663c92d917b5ca2e5c945d3664a9bc781b) |

LemmaX then withdrew its 0.003 USDC of execution charges ([0x3652f0a6](https://testnet.monadvision.com/tx/0x3652f0a67d7d2e91daeb202cc355df3c4d0136cc2192c6989fe0e7e244c0c170)). The remaining credit matches the planned allocation exactly: buyer 0.0144 USDC (the 0.008 timeout refund, 0.0007 unused caps after success and 0.0057 after failure), provider 0.005 and evaluator 0.0016. The contract balance equals that outstanding credit, nothing is locked, and reconciliation of the run's events against the private quotes and receipts reported no issues. The buyer spent 0.024 USDC; relaying cost the facilitator 0.103 MON and the evaluator 0.048 MON. [Live report](../verification/testnet-demo.json).

Monad Testnet receipts report gas used equal to the transaction gas limit, consistent with charging the limit: funding 276,815 to 314,498, successful settlement 237,465, failure settlement 141,554 and refund 88,477. The public RPC limits `eth_getLogs` to 100 blocks, so the reconciler reads in 100-block chunks. An earlier, interrupted run had deployed the contract without emitting any event, so this run read events from its own first block (`LEMMAX_SETTLEMENT_FROM_BLOCK`) and reused the contract (`LEMMAX_SETTLEMENT_ADDRESS`).

## 5. Roadmap

**Done.** Three purchases ran on Monad Testnet with contract version 2 and reconcile with their private records, and the contract source is verified (section 4). Contract version 3 with automatic payouts, the streamed fund call, the rulebook and shared conformance rules, the Envio auditor, the Privy buyer mandate and guard, ERC-8004 registration and feedback, and the trust-loop runner are built and checked, and the loop is rehearsed on a fork. Version 3 is deployed and source-verified and has run 18 attempts on testnet ([record](../verification/live-runs-testnet.json)); the hosted Envio auditor indexes them, agrees with the local auditor on every one, gates the page's purchases, and flagged the canary checker's overcharge in the testnet trust loop ([check](../verification/auditor-check-testnet.json), [loop](../verification/trust-loop-testnet.json)). The Privy policy passed its kill test ([report](../verification/privy-kill-test.json)), and LemmaX's four ERC-8004 agents are registered with feedback published from the settled attempts ([record](../verification/reputation-testnet.json)). [Trust loop](Trust-Loop.md).

**Next.** Create the buyer's own Privy wallet, now that its kill test has passed. Then run the assessment scale protocol from the [architecture](LemmaX-Architecture.md#minimum-evidence-of-scale-readiness) and extend the cost ledger with measured testnet gas. A remote MCP transport for purchases needs authentication before it serves anyone beyond the operator. The validation registry stays outside the settlement path. [Monad ERC-8004 guide](https://docs.monad.xyz/guides/erc-8004), [ERC-8004 contracts](https://github.com/erc-8004/erc-8004-contracts), [Envio supported networks](https://docs.envio.dev/docs/HyperIndex/supported-networks).

## 6. Version 1 terms

The version 1 terms use published reference prices and a recorded version 2 cost snapshot. They keep their original identifier, `lemmax-demo-terms/v1`, and remain fixed; the version 3 payout path did not revise the tariff. Reference prices and the MON price are assumptions for these calculations. They do not establish current production costs or a sustainable margin for every payout pattern.

### Reference prices and measured costs

- **Hosted retrieval APIs.** These are published per-request prices for search APIs that return ranked sources. Exa Instant: $4 per 1,000. Tavily basic: $8 per 1,000. Brave Search API: $5 per 1,000. Perplexity Search API: $5 standard or $1 fast. Serper: $1. Linkup standard: $5. Parallel: $1 or $5. You.com: $5. The median of eleven verified services is **$0.005 per request**; the range is $0.001 to $0.008 without subscription-only plans. [Exa](https://exa.ai/pricing), [Tavily](https://www.tavily.com/pricing), [Brave](https://brave.com/search/api/), [Perplexity](https://docs.perplexity.ai/docs/getting-started/pricing), [Serper](https://serper.dev/), [Linkup](https://docs.linkup.so/pages/documentation/platform/pricing), [Parallel](https://parallel.ai/pricing), [You.com](https://you.com/pricing).
- **Search over your own data.** Google Vertex AI Search lists $1.50 per 1,000 queries (Standard) and $4.00 (Enterprise), with index storage billed separately. [Vertex AI Search pricing](https://cloud.google.com/generative-ai-app-builder/pricing).
- **Building blocks.** Cohere Rerank 4 Fast costs $2.00 per 1,000 searches of up to 100 documents. OpenAI `text-embedding-3-small` and Voyage `voyage-4-lite` cost $0.02 per million tokens. A Pinecone serverless query on a small namespace uses 0.25 read units, about $0.000004. [Cohere](https://cohere.com/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing), [Voyage](https://docs.voyageai.com/docs/pricing), [Pinecone](https://docs.pinecone.io/guides/manage-cost/understanding-cost).
- **LLM reading.** Claude Haiku 5.5 lists $0.10 per million input tokens for prompts up to 100,000 tokens. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- **Compute.** BM25 and TF-IDF scoring measured 2.5 ms mean per query. On AWS Lambda arm64 ($0.0000133334 per GB-second, $0.20 per million requests, 1 ms billing) that is about $0.0000002 per query. [AWS price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json).
- **Historical version 2 gas basis.** The terms use a total gas price of 102 MON-gwei and a MON price of $0.0248. Applied to the recorded version 2 limits, funding costs 0.0319 MON (about $0.00079), success settlement 0.0222 MON (about $0.00055), and failure settlement 0.0143 MON (about $0.00035). `OPERATOR_COST_SNAPSHOT` in [`src/terms.mjs`](../src/terms.mjs) retains the version 2 funding-and-compute estimate. These are snapshot calculations, not live quotes. [Historical gas reports](#verification), [CoinGecko](https://www.coingecko.com/en/coins/monad), [CoinMarketCap](https://coinmarketcap.com/currencies/monad/).

### Tariff, equal for both offers

| Term | USDC | Atomic | Basis |
| --- | ---: | ---: | --- |
| Principal P | 0.005 | 5000 | Median hosted retrieval price per request |
| Execution charge e | 0.0015 | 1500 | Version 2 funding-and-compute reference |
| Execution cap E | 0.002 | 2000 | Headroom over e |
| Evaluation charge v | 0.0008 | 800 | Version 2 settlement-and-label-check reference |
| Evaluation cap V | 0.001 | 1000 | Headroom over v |
| Funded total | 0.008 | 8000 | P + E + V |

Success credits the connector 0.005, the executor 0.0015 and the evaluator 0.0008, and returns 0.0007 to the buyer. Eligible failure returns 0.0057 to the buyer. Timeout returns 0.008. The execution charge is LemmaX's designated revenue. Its historical version 2 contribution estimate of about $0.0007 per funded attempt subtracts only the recorded funding relay and scoring cost. It excludes hosting, previews, timeout relays and other operating costs. One faucet allowance of 10 USDC covers 1,250 funded attempts.

### Version 3 gas sensitivity

The current [fork report](../verification/settlement-fork-check.json) records a funding limit of 322,274, success settlement of 356,337 and failure settlement of 259,510. Applying the same explicit assumptions of 102 MON-gwei and $0.0248 per MON gives gas costs of about $0.000815, $0.000901 and $0.000656 respectively. The calculation uses `gasLimit * 102e-9 MON * $0.0248`, since Monad charges the limit.

Payout patterns change those limits. The recorded success with one payout uses 381,307 gas (about $0.000965), and settlement with three fresh-account payouts uses 494,091 gas (about $0.001250). The fixed 0.0008 evaluation charge therefore does not cover the gas of those recorded success paths under these price assumptions. Its gas-only break-even MON price is about $0.0220 for the ordinary success row and $0.0159 for the three-fresh-payout row, before label checking or other costs. The earlier $0.036 threshold applied to version 2 success settlement. No tariff or allocation policy is changed by this comparison.

The recorded version 3 timeout limit is 216,283, or about $0.000547 in gas under the same assumptions. Timeout refunds all 0.008 USDC and earns no attempt fee. Customer pricing needs a cost model that includes these branches, payout patterns and current network prices.

### Buyer's direct alternative

`C_reuse` needs the buyer's cost of completing the same outcome without the purchase. The buyer agent declares two hypothetical cost scenarios for the 5,183-document corpus (about 1.94 million tokens). Neither alternative was executed or evaluated against the retrieval benchmark, so their cost inputs do not prove equivalent result quality or measured savings:

- **Own retrieval pipeline: about $0.0024 per query.** Cohere rerank, query embedding and a vector query, plus one-time corpus embedding spread over the 100-query illustrative workload. Engineering time is excluded.
- **LLM reads the corpus: about $0.194 per query.** Claude Haiku 5.5 input in chunks under 100,000 tokens. Output tokens are excluded.

Conditional on those declared costs, a uniform prior and treating the representative public cohort as independent, the assessment library gives:

| Buyer alternative | BM25 p, expected cost | TF-IDF p, expected cost | Expected saving |
| --- | --- | --- | --- |
| Own pipeline, 0.0024 | 0.743, 0.0066 | 0.763, 0.0067 | negative, about -0.004 |
| LLM reads corpus, 0.194 | 0.743, 0.0559 | 0.763, 0.0521 | positive, about 0.14 |

With these inputs, TF-IDF ranks first when the alternative is expensive. The own-pipeline scenario produces negative expected savings. The buyer agent uses the LLM-reads-corpus scenario for its main run and shows the own-pipeline case once. The fixed demonstration overhead (e + v = 0.0023) is almost half the principal; the version 3 gas sensitivity above also shows why this tariff cannot be treated as proof of sustainable sub-cent settlement. Batching remains a proposed direction. Probabilities describe the public benchmark under the disclosed independence assumption, not calibrated customer outcomes.

### Deadline profiles

Measured work takes seconds: Verified arrives about 1.5 s after inclusion, scoring takes 2.5 ms on average, and an MCP round trip measured 46 ms at the 95th percentile. The windows below therefore cover agent and wallet response, polling and second-granularity timestamps, not compute.

| Profile | Funding window | Execute by | Settle by | Timeout refund available |
| --- | ---: | ---: | ---: | ---: |
| `demo-standard/v1` | 120 s | issue + 240 s | issue + 600 s | after 10 minutes |
| `demo-timeout/v1` | 60 s | issue + 120 s | issue + 180 s | after 3 minutes |

The buyer authorization window ends one second after the quote expires. The timeout profile is used once, with the evaluator withholding its receipt, so the full refund can be shown live.

## 7. Testnet roles and funding

The operator environment carries keys from the earlier Lemma deployment. Each is an ordinary EOA, so the same addresses work on Monad Testnet. The table records version 2 roles and approximate gas budgets, rather than version 3 payout costs. Values are never printed or committed.

| Variable | Role | Needs on Monad Testnet |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | Deploys `AttemptSettlement` | About 0.21 MON for one deployment |
| `FACILITATOR_PRIVATE_KEY` | Quote issuer, funding relayer, executor payee | About 0.032 MON per funded attempt |
| `EVALUATOR_PRIVATE_KEY` | Evaluator signer and payee, settlement relayer | About 0.022 MON per settlement |
| `PROVIDER_PRIVATE_KEY`, `LEMMA_PROVIDER_ADDRESS` | Connector payee for both offers | MON only to withdraw credit |
| `BENCHMARK_BUYER_PRIVATE_KEY`, `BENCHMARK_BUYER_ADDRESS` | Test buyer agent; signs EIP-3009 authorizations | USDC to fund; MON only to withdraw credit |
| `LEMMA_MAX_USDC_PER_RESOLUTION`, `LEMMA_DAILY_USDC_CAP` | Issuer refuses terms above the per-attempt total, and any quote that would take the chain day's issued total, funded or not, past the daily cap | None |

The Arbitrum Sepolia variables and `RESOLUTION_WARRANTY_REGISTRY_ADDRESS` belong to the earlier deployment and are not used on Monad. The issuer and evaluator keys are distinct, so the two authorities stay separate onchain.

The operator funded the deployer, facilitator and evaluator with testnet MON and the buyer with faucet USDC. A captcha-free route for USDC is Circle CCTP from Arbitrum Sepolia, which Circle's forwarding service can complete on Monad without the recipient holding MON; MON itself still has to come from a faucet.

## 8. Decisions settled after the live run

1. **Withdrawal bar.** Decided: credit at or above the owner's bar pays out in full automatically; the minimum is 0.01 USDC. [Trust loop](Trust-Loop.md#1-the-monad-problem-stranded-agent-funds).
2. **Indexer.** Decided: Envio is the public auditor whose verdicts gate the buyer's wallet; the in-repo reconciler and the local auditor remain independent checks.
