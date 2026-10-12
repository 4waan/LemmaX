# LemmaX

<!-- one-liner: founders to replace -->
Pay for the result, not the call. AI agents buy paid search in USDC on Monad, see the odds first, get the price back on a miss, and their wallet signs only bills a public auditor cleared.
<!-- end one-liner -->

LemmaX is for teams whose AI agents buy search from paid providers. Each purchase is one search that returns up to five cited sources.

## What it does

1. **Odds first.** Before paying, the agent sees each offer's top-five hit rate on the public SciFact benchmark: [BM25 74.67%, TF-IDF 76.67%](benchmarks/retrieval-paired-results.json).
2. **One signature, no MON.** The agent pays with one signed USDC authorization, which LemmaX relays.
3. **Price back on a miss.** A checker settles each search. A miss refunds the 0.005 USDC search price, not the service fees. Contract v3 pays each owner in that same transaction once its credit reaches 0.01 USDC.
4. **A public auditor.** Envio checks every settlement against a hash-pinned rulebook. The buyer's guard then refuses the next bill naming a flagged party (rehearsed on a fork).

## Verify in 60 seconds

| Claim | Evidence |
| --- | --- |
| Contract v3, current | [`0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7`](https://testnet.monadvision.com/address/0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7), exact Sourcify match, [deployment record](deployments/AttemptSettlement-v3.testnet.json) |
| [v2 live](verification/testnet-demo.json): success | fund [0xd992b619](https://testnet.monadvision.com/tx/0xd992b619833cfde8ab9eb09727e7c005b99728ccde3e7279b287140cf562a658), settle [0x28dea749](https://testnet.monadvision.com/tx/0x28dea749676021673024c96ac1c6ee17ad6356cbd6a5667abcb54c00acbb6ac4) |
| v2 live: miss, price refunded | fund [0xacc329b5](https://testnet.monadvision.com/tx/0xacc329b5b4e6fcd64bcabca7251c05feada9b39aa260c81527686123bfbadafa), settle [0xacd6d2f3](https://testnet.monadvision.com/tx/0xacd6d2f3652ab0b8a8be679851bdab663c92d917b5ca2e5c945d3664a9bc781b) |
| v2 live: timeout, full refund | fund [0xffeb4190](https://testnet.monadvision.com/tx/0xffeb419092994c492a8bcc53adbb9ef1f80ca9a72c525ffd0032e63d09ecd85c), refund [0x7b4078e7](https://testnet.monadvision.com/tx/0x7b4078e70ef7b8003d69cdd27f04d88edd6c925178b99b0f9d57f940c43a0ec2) |
| Trust loop, fork rehearsal | [verification/trust-loop-fork.json](verification/trust-loop-fork.json) |
| Public page, fork rehearsal | [verification/live-check-fork.json](verification/live-check-fork.json): a hit, a miss and three refused tricks, 10 of 10 checks |
| Tests | `npm ci && npm test` runs 94 tests |
| Live page | coming |
| Envio GraphQL endpoint | coming |
| Privy kill-test report | coming |
| Videos | coming |

## Why Monad

- **Refunds could be stranded.** Monad charges the full gas limit and keeps a 10 MON reserve. An agent holding only USDC could not withdraw its own refund.
- **Payouts ride inside settlement.** Contract v3 pays credit out in the settlement transaction that LemmaX's relayer pays for.
- **Money waits for Verified.** Funding reports Monad's commit states (Proposed, Voted, Finalized, Verified) as MCP progress. It returns at Verified, as Monad advises for offchain money logic. [Details](docs/Trust-Loop.md#1-the-monad-problem-stranded-agent-funds)

## Sponsor tools

| Tool | Its job | Files | Status |
| --- | --- | --- | --- |
| Envio | Decides whether the buyer's wallet may sign | [indexer/config.yaml](indexer/config.yaml), [indexer/schema.graphql](indexer/schema.graphql), [indexer/src/handlers/settlement.ts](indexer/src/handlers/settlement.ts), [indexer/src/shared/conformance.mjs](indexer/src/shared/conformance.mjs), [src/audit.mjs](src/audit.mjs), [src/guard.mjs](src/guard.mjs) | Code and tests. Hosted deployment coming |
| Privy | Server wallet whose policy signs only approved bills | [src/privy-buyer.mjs](src/privy-buyer.mjs), [scripts/privy-kill-test.mjs](scripts/privy-kill-test.mjs), [scripts/privy-setup.mjs](scripts/privy-setup.mjs) | Code and tests. Live kill test coming |
| ERC-8004 | Four agent identities and feedback from settled attempts only | [src/erc8004.mjs](src/erc8004.mjs), [scripts/register-agents.mjs](scripts/register-agents.mjs), [scripts/publish-reputation.mjs](scripts/publish-reputation.mjs), [src/reputation.mjs](src/reputation.mjs) | Code and tests. Registration coming |

## Live, rehearsed, not yet

| Stage | What |
| --- | --- |
| Live on Monad Testnet | Contract v2 ran three paid attempts: success, miss and timeout refund. Contract v3 is deployed and verified. |
| Runs locally | MCP server, with the operator's quote, fund and status tools. |
| Rehearsed on a fork | Full trust loop, with a local auditor and local mandate. The public page: buy a search, three refused tricks, the record lookup and MCP over HTTP. |
| Not yet | Hosted Envio auditor, Privy wallet, ERC-8004 registration, trust loop on testnet, live page. |

## Limits, stated once

- LemmaX runs the demonstration checkers, and the rulebook says so.
- The auditor checks rules, not result quality.
- Refunds need a known right answer, so the paid unit is a public benchmark search.
- Testnet only, with no customers or revenue yet.

## Team

<!-- team: founders to add one credential line each -->
Aryan Singh Rathore and Awaan Mustafa Siddiqui, co-founders.

## Run locally

Use Node.js 22 or newer. The demos use synthetic prices and need no model API key.

```sh
npm ci --ignore-scripts
npm test
npm run demo
npm run demo:billing
npm run benchmark:verify
```

Retrieval and MCP need the public SciFact corpus ([setup](docs/Retrieval-and-MCP.md#reproduce-locally)). The trust loop rehearsal on a local fork also needs Anvil 1.8 or newer, `LEMMAX_FORK_RPC_URL` and the [role keys](docs/Monad-Settlement-Path.md#7-testnet-roles-and-funding).

```sh
LEMMAX_DEMO_TARGET=fork npm run demo:loop
npm run live:check   # the public page, rehearsed on a fork
npm run live         # the public page itself, on Monad Testnet
```

## More detail

- [The trust loop](docs/Trust-Loop.md): how the auditor, the buyer's wallet and agent identity fit together.
- [Monad settlement path](docs/Monad-Settlement-Path.md): deployment, the live run and the demonstration prices.
- [Attempts and settlement](docs/Attempt-and-Settlement.md): the contract, its allocations and its checks.
- [Retrieval and MCP](docs/Retrieval-and-MCP.md): the two search offers, the benchmark and the MCP tools.
- [Architecture](docs/LemmaX-Architecture.md): what stays private and what goes onchain.
- [Paid unit](docs/Paid-Unit.md): what one purchase covers.
- [Assessment library](docs/Implementation.md): the probability, cost and billing functions.
- [Research notes](docs/research/): decision mathematics and API, business requirements, the reuse review and blob storage.

### Evidence files

- [Paired benchmark](benchmarks/retrieval-paired-results.json): BM25 224 of 300 and TF-IDF 230 of 300 public queries with a right source in the top five.
- [Local settlement checks](verification/settlement-check.json): 80 checks under Monad execution rules.
- [Fork settlement checks](verification/settlement-fork-check.json): 77 checks against Circle's USDC on a fork of Monad Testnet.
- [v2 live run](verification/testnet-demo.json) and its [fork rehearsal](verification/testnet-demo-fork.json).
- [Trust loop fork rehearsal](verification/trust-loop-fork.json).
- [Numerical oracle](verification/numerical-verification.json): 225 Beta quantiles and 400 money expectations, checked with separate Python Decimal formulas.
- [Billing oracle](verification/billing-verification.json): 342 billing cases.
- [Retrieval check](verification/retrieval-verification.json): all 300 top-five rankings for both offers, recomputed in Python.
- [MCP smoke run](verification/mcp-smoke.json): 200 benchmark replays through the real MCP SDK.
- [Attempt encoding oracle](verification/attempt-verification.json): 128 commitments, 256 typed digests and 256 allocations, for the earlier signing domain.

These are checks written by the team, not an independent security review.

### Repository hygiene

Private records, environment files and raw run directories are excluded. Before publication or push, scan staged changes and full history with gitleaks. The optional pre-commit hook requires gitleaks; activate it with `git config core.hooksPath .githooks`. No earlier repository source code or model weights were copied into LemmaX.

## License

LemmaX is MIT licensed ([LICENSE](LICENSE)). Third-party data, packages and tools keep their own terms ([THIRD_PARTY.md](THIRD_PARTY.md)).

AI tools assisted in developing this project.
