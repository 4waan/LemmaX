# LemmaX on Monad: architecture, deployment path and plan

Package version 0.4.0. This slice prepares the implemented settlement prototype for a Monad network without using wallet credentials or funds. It adds network profiles, a gas and confirmation policy, a typed settlement client, event reconciliation and a deployment script that defaults to a dry run. No contract is deployed to Monad Testnet or mainnet. [Attempt and settlement contract](Attempt-and-Settlement.md).

## 1. Current architecture

Two paths are implemented. They are not yet joined by a purchase path.

**Directory path, public and read-only.** The frozen SciFact report feeds two connectors (`src/retrieval.mjs`), the decision core (`src/beta.mjs`, `src/assessment.mjs`, `src/billing.mjs`), the public directory (`src/directory.mjs`) and the stdio MCP server (`src/mcp.mjs`). It returns observed hit rates and assessments, redacts operator contribution and reports `fundable: false`. [Retrieval and MCP](Retrieval-and-MCP.md).

**Financial path, local Monad execution.** Private records, commitments and EIP-712 quotes and receipts (`src/attempt.mjs`) pass through the Monad client (`src/monad.mjs`, `src/settlement.mjs`) to `AttemptSettlement.sol`. The reconciler (`src/reconcile.mjs`) reads the contract's events back and matches them with the private quotes and receipts. `scripts/deploy-settlement.mjs` deploys the contract.

**Missing join.** The MCP server cannot issue a fundable quote, ask a wallet to fund it, or report settlement status. Those three steps are the purchase path planned below.

The target lifecycle for one attempt:

```text
1  agent        -> directory    lemma_assess (implemented)
2  directory    -> agent        pOutcome, C_reuse, rank
3  agent        -> directory    lemma_quote_attempt (planned)
4  directory    -> agent        signed quote, sealed private record
5  agent wallet -> Monad        fund(quote, signature), value P+E+V
6  Monad        -> executor     AttemptCommitted, wait for Verified
7  executor and evaluator       run connector, check privately, sign receipt
8  any relayer  -> Monad        settle(receipt, signature)
9  Monad        -> reconciler   AttemptOutcome, credits
10 reconciler   -> agent        lemma_attempt_status (planned)
11 owner        -> Monad        withdraw(amount, destination)
   no valid receipt by settleBy: anyone calls refundTimeout for a full refund
```

Steps 1, 2, 5, 6, 8, 9 and 11 run today against local Monad execution. Step 7 exists as the signed example in `examples/attempt.mjs`, not as a service. The public and private boundary is unchanged from the [architecture](LemmaX-Architecture.md#3-what-is-public-on-monad): Monad sees the attempt ID, record commitment, quote digest, wallets, amounts, deadlines, outcome and consumed charges; the company keeps the record, salt, query, sources and evidence.

## 2. Monad behaviour that shapes the implementation

These properties were checked against official documentation and live public RPC responses during this slice. Recheck them before a deployment, since network parameters change through upgrades.

- **The gas limit is charged.** Monad charges the gas limit set in the transaction rather than the gas used. A transaction that reverts after inclusion still pays its full limit. [Gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing).
- **Reserve balance.** Asynchronous execution reverts, while still charging gas, a native-value spend that leaves an EOA below the lower of its starting balance and 10 MON. An "emptying" transaction is exempt when the sender is undelegated and has sent no other transaction in the previous three blocks. [Reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance).
- **Commitment stages.** Blocks move through Proposed, Voted, Finalized and Verified. The RPC `latest`, `safe` and `finalized` tags map to the first three. Verified is the finalized head minus three blocks, the execution delay. Monad recommends waiting for Verified before significant offchain financial effects. [Block states](https://docs.monad.xyz/monad-arch/consensus/block-states), [developer summary](https://docs.monad.xyz/developer-essentials/summary).
- **Storage pricing.** Under the current hardfork, cold storage is charged per 128-slot page and a new storage slot carries a state-growth charge. [Opcode pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing).
- **Networks.** Testnet is chain 10143 and mainnet chain 143; the native token is MON with 18 decimals. Viem 2.57.4 exports both definitions. [Network information](https://docs.monad.xyz/developer-essentials/network-information), [testnet](https://docs.monad.xyz/developer-essentials/testnet).
- **Toolchain.** Compilation for Monad requires the `osaka` EVM target, which the compile script already uses. Foundry 1.8 or newer runs Monad execution with `--network monad`. [Hardhat guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/hardhat), [Foundry guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/foundry).
- **Source verification.** MonadVision verifies through a Sourcify endpoint; Monadscan uses an Etherscan-style API. [Foundry verification](https://docs.monad.xyz/guides/verify-smart-contract/foundry).

## 3. Implemented in this slice

### Network profiles and confirmation

`connectMonad({ network, rpcUrl, allowMainnet })` accepts only `local`, `testnet` or `mainnet`, requires an explicit HTTP(S) RPC URL and refuses mainnet without explicit permission. It compares the chain ID reported by the RPC with the selected profile before returning a client. There is no default public endpoint.

`waitForStage(client, inclusion, stage, timing)` supports `included`, `finalized` and `verified`. Finalized waits for the RPC finalized head to reach the inclusion block. Verified waits for three further blocks. Both then confirm that the inclusion block hash is still canonical. Polling interval and timeout are explicit. The stage for releasing a connector run or crediting an external ledger is a caller decision; the recommended stage for financial effects is `verified`.

### Gas limits and the reserve balance

`gasLimitFor(estimate, headroomBps)` adds explicit headroom, bounded to 0 to 5000 basis points, to an estimate. Because the limit is billed, headroom is paid even when unused. It exists to cover state changes between estimation and inclusion, such as a payee's credit slot changing from zero.

`dipsIntoReserve(balance, value)` applies the reserve rule above. `fund` refuses a native spend that would dip into the reserve unless the caller passes `allowReserveDip: true`, stating that the transaction qualifies as an emptying transaction. Gas spend is checked by consensus separately and is not modelled.

### Settlement client

`createSettlementClient({ publicClient, address, gasHeadroomBps })` wraps `fund`, `settle`, `refundTimeout` and `withdraw`. Every write is estimated first, so an invalid quote, receipt or state returns a named custom error (`InvalidQuote`, `InvalidAuthority`, `InvalidReceipt`, `InvalidState`, `NotExpired`, `InvalidWithdrawal`) without mining a reverted transaction. The client converts canonical decimal strings to exact integers and funds exactly the signed total. Read helpers return the attempt state, owner credit, approved issuer and the ledger. The ledger reports balance, locked funds, total credit and any unallocated surplus; it is solvent when balance covers locked funds plus credit.

The contract ABI is committed in `contracts/AttemptSettlement.abi.json` so runtime clients do not need the compiler. A unit test fails if it differs from a fresh compilation. `npm run contract:abi` regenerates it.

### Reconciliation

`readSettlementLogs` reads `AttemptCommitted`, `AttemptOutcome` and `CreditWithdrawn` events over a block range in caller-sized chunks, since RPC providers bound `eth_getLogs` ranges. `reconcileAttempts` takes those events and the private quotes and receipts the company holds. It deduplicates repeated delivery by transaction hash and log index, and reports conflicting duplicates. For each private attempt it checks the record commitment and domain-bound quote digest, a single commitment and terminal outcome, receipt agreement with the event, timeout events without charges, agreement with the onchain state when supplied, and the resulting allocation. With a ledger it checks solvency and that locked funds cover the company's open attempts. Events for other buyers' attempts appear only as unmatched identifiers. Nothing private is read from the chain or added to it.

### Deployment

`scripts/deploy-settlement.mjs` compiles the contract, checks the committed ABI, estimates deployment gas and prints the bounded charge, gas limit times maximum fee per gas. Without `LEMMAX_DEPLOY_BROADCAST=1` it sends nothing.

```sh
export LEMMAX_MONAD_NETWORK=testnet
export LEMMAX_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
export LEMMAX_QUOTE_ISSUER=0xApprovedQuoteIssuer
export LEMMAX_GAS_HEADROOM_BPS=1000
npm run deploy:settlement
```

Broadcasting additionally requires `LEMMAX_DEPLOYER_KEY`, `LEMMAX_CONFIRMATION_STAGE` (`included`, `finalized` or `verified`) and `LEMMAX_DEPLOYMENT_OUTPUT`, an ignored directory such as `private/deployments`. Mainnet requires `LEMMAX_ALLOW_MAINNET=1`. After the chosen stage, the script compares deployed runtime code with the build after zeroing constructor-set immutables, and checks the approved issuer and EIP-712 domain. It writes a manifest with the address, transaction, block, gas, compiler, masked runtime hash and source hashes, plus a self-contained standard JSON input for Sourcify or explorer verification. The key is read from the environment and never printed or written.

### Verification

The Node suite has 63 passing tests, including the ABI drift check, gas policy, reserve rule, stage waits against a simulated RPC, and reconciliation of matching, tampered and duplicated events.

`npm run settlement:check` now runs the lifecycle through the deployment function, the operator script in dry-run and broadcast modes, the settlement client and the reconciler. Anvil runs with Monad execution and one-slot epochs, so its finalized head trails the latest block by two blocks; this stands in for Monad's stages and is not Monad consensus. The check passed 64 assertions, including verified-stage deployment, named custom errors for every rejected path, the reserve guard, chunked event reads with duplicated delivery, and a tampered private receipt being reported. [Lifecycle report](../verification/settlement-check.json).

Gas measured under that execution with 10% headroom:

| Operation | Gas used | Gas limit charged |
| --- | ---: | ---: |
| Deploy | 1,745,774 | 1,920,352 |
| `fund` | 353,458 | 391,199 |
| `settle`, success | 188,124 | 209,332 |
| `settle`, eligible failure | 117,400 | 131,535 |
| `refundTimeout` | 87,323 | 98,455 |
| `withdraw` | 74,486 | 84,332 |

At the 100 MON-gwei minimum base fee and no priority fee, the funding limit costs about 0.039 MON and deployment about 0.19 MON. These are local execution measurements, not testnet receipts. Random identifiers change calldata zero bytes, so repeated runs differ by a few gas units. Most of the funding gas stores the full quote in contract storage.

## 4. Plan

Each phase keeps the agreed privacy boundary, evaluator trust model and refund policy. Phases after the first need the decisions in section 5.

**Phase 2: contract version 2 for testnet.** Store only the quote digest, funding time and state, and pass the quote back as calldata to `settle` and `refundTimeout`. Events already carry the digest and commitment. This should remove most of the funding storage cost; measure it rather than assume it. If selected, add ERC-20 funding beside native MON. Rerun the lifecycle check and the encoding oracle. Exit: identical allocations and invariants, lower measured funding gas.

**Phase 3: testnet purchase path.** Deploy to chain 10143 with a stated budget and verify the source on MonadVision. Run the quote issuer and evaluator as small services with keys supplied by the environment. Add `lemma_quote_attempt` and `lemma_attempt_status` to an authenticated MCP transport; the buyer's wallet signs funding itself. Run one success, one eligible failure and one timeout on testnet and publish the reconciliation report. Exit: three settled testnet attempts whose events reconcile with their private records.

**Phase 4: trust and identity.** Register the directory agent and evaluator in the ERC-8004 Identity Registry, which is deployed on Monad mainnet and testnet; the validation registry is still pending and remains outside the settlement path. Publish authorized feedback after settlement only under an explicit disclosure policy. Add Envio HyperIndex, which supports both Monad networks, if a live status view needs more than the reconciler. Automate the withdrawal bar once its meaning is chosen. [Monad ERC-8004 guide](https://docs.monad.xyz/guides/erc-8004), [ERC-8004 contracts](https://github.com/erc-8004/erc-8004-contracts), [Envio supported networks](https://docs.envio.dev/docs/HyperIndex/supported-networks).

**Phase 5: evidence and submission.** Run the assessment scale protocol from the [architecture](LemmaX-Architecture.md#minimum-evidence-of-scale-readiness), extend the cost ledger with measured testnet gas, and prepare the technical demonstration.

## 5. Open decisions

These are proposals for review, not selected policy.

1. **Funding asset.** Native MON only, or ERC-20 as well. Circle USDC is deployed on both Monad networks with 6 decimals. ERC-20 funding spends no native value and so cannot trip the reserve revert; it adds an approval step and token handling. Proposal: add USDC in Phase 2 and keep native MON. [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
2. **Demo issuer and evaluator keys.** Proposal: two separate keys operated for the demonstration, labelled as internal, so the issuer and evaluator authorities are distinct onchain. A real company-approved evaluator remains the production requirement.
3. **Live network.** Proposal: testnet first; mainnet only after the three-outcome run reconciles.
4. **Indexer.** Proposal: keep the in-repo reconciler as the correctness check and add Envio only for a status view.
5. **Withdrawal bar.** Accumulated-credit trigger or retained working balance, and the minimum. [Paid unit](Paid-Unit.md#reserve-credit-and-agent-controlled-withdrawal).
6. **Demo tariffs and deadlines.** Atomic principal and caps, and the quote, execution and settlement windows. No defaults are assumed.
