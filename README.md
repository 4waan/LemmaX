# LemmaX

LemmaX is a directory for comparing versioned resource offers by a scoped outcome probability and expected completion cost. Explicit contribution accounting governs which services LemmaX can sustainably offer.

The initial capability is authorized source retrieval through a connector/MCP tool. The working demo purchase is one bounded retrieval attempt. Company-approved evaluation keeps detailed evidence private; Monad will hold the attempt commitment and financial settlement.

## Current implementation

The assessment and retrieval cores use only the Node standard library. The implemented slice includes:

- Beta posterior means and equal-tail credible intervals from explicitly configured, already admitted evidence.
- Evidence/profile/version matching, freshness, completeness and independence guards.
- Null forecasts and ranks for missing or inapplicable evidence.
- Expected completion cost, probability-only cost intervals and direct-completion savings.
- Contribution and service-availability gates, without changing probabilities to favor commission.
- Deterministic cost ordering for eligible, evidenced, commercially available offers in one currency.
- Workload allocation for pay-as-you-go, new subscriptions and authorized existing allowances, with reserved quota and overage constraints.

Two working retrieval offers use BM25 and TF-IDF. Their paired SciFact benchmark and a public stdio MCP server support discovery, assessment, retrieval, source reading and replay. Trusted private-company evidence admission, HTTP transport, authenticated private purchase transport, persistent key/record custody and Monad Testnet deployment are subsequent work. Signed attempt primitives and a USDC settlement contract are implemented and tested under Monad execution, including against Circle's deployed testnet USDC on a local fork. A buyer funds an attempt with one EIP-3009 authorization bound to the signed quote. It is deployed and source-verified on Monad Testnet at [`0xfb59487E973C883E3fe4301238D485f7B248fA7f`](https://testnet.monadvision.com/address/0xfb59487E973C883E3fe4301238D485f7B248fA7f). No customer adoption, production prices or revenue forecast is claimed.

## Run locally

Use Node.js 22 or newer. Install the pinned MCP runtime dependencies; no model API key is needed.

```sh
npm ci --ignore-scripts
npm test
npm run demo
npm run demo:billing
npm run benchmark:verify
```

`npm run demo` marks every offer, count, tariff and policy as synthetic. Its numerical values are not the measured SciFact result or selected commercial defaults. `npm run benchmark:verify` independently recomputes stored relevance metrics and checks the measured runner hash; it does not rerun retrieval or certify the stored labels.

To rerun retrieval, obtain the public SciFact dataset from the source documented in [the benchmark runner](benchmarks/scifact_bm25.py), then pass local paths using its `--help` instructions. The dataset and document text are not vendored. [Dataset attribution and rights](THIRD_PARTY.md).

`npm run demo:billing` compares synthetic tariffs at three workload sizes. These are workload averages, not next-request charges. No provider calls or quota reservations are performed.

`npm run deploy:settlement` estimates a Monad deployment and sends nothing unless broadcasting is explicitly enabled. [Network settings, confirmation stages and deployment](docs/Monad-Settlement-Path.md).

To run retrieval and MCP, prepare the public corpus outside tracked source and set `LEMMAX_SCIFACT_DIR`. [Setup, tool schemas and measured limitations](docs/Retrieval-and-MCP.md). Then run `npm run demo:retrieval` or `npm run mcp:check`. Clients launch `node scripts/mcp-server.mjs` directly through stdio.

## Boundaries

The library consumes authorized server-side evidence snapshots and configured economics. It does not authenticate snapshots or accept client-supplied counts as trusted evidence. The current MCP wrapper serves only frozen public benchmark data, rejects caller-supplied trusted fields, and loads version-checked evidence internally. Private/company deployment requires authenticated access and admitted evidence.

Library results include internal contribution information. The public MCP wrapper redacts it. Private company evidence must not be returned to another tenant. A public benchmark forecast cannot stand in for company integration acceptance.

Forecast money uses finite decimal numbers. Actual quotes and settlement need integer atomic units and separate authorization. No forecast is permission to spend or a settlement verdict. The initial Beta implementation supports each shape parameter at least 0.5 and total posterior shape at most 10,000; this is a numerical implementation limit, not a selected evidence policy.

## Verification

The library has 68 passing Node tests. A separate Python Decimal oracle checked 225 Beta quantiles and 400 monetary expectations against different formulas. The maximum checked CDF difference was approximately `3.07e-12`; the maximum monetary difference was `3e-13`. This is numerical verification, not an independent human audit or probability calibration. [Verification report](verification/numerical-verification.json).

A separate Python Decimal per-unit billing oracle checked 342 cases, including quota boundaries and disabled overage. Maximum per-case cost difference was `2e-15`. [Billing verification report](verification/billing-verification.json).

The earlier SciFact run hit a relevant source in the top five on 224 of 300 queries, or 74.67%. It used no paid API calls or model training. That is one untuned lexical baseline, not a model comparison, enterprise acceptance result, or API capacity claim. [Measured report](benchmarks/scifact-bm25-results.json).

The paired benchmark measured BM25 at 224/300 successful cases (74.67%) and TF-IDF at 230/300 (76.67%). The default MCP assessment reports these observed rates and leaves model probability/cost ranks unknown. An explicit illustrative scenario demonstrates conditional probability and workload cost ranking with disclosed independence assumptions and synthetic tariffs. [Measured comparison](benchmarks/retrieval-paired-results.json).

The real SDK smoke check matched 200 replays across request windows of one and four. It is a bounded local integration probe, not production capacity or partner adoption. [Smoke report](verification/mcp-smoke.json).

The USDC settlement contract passed 62 lifecycle checks in isolated Anvil with Monad execution rules and a FiatToken test double, and 59 checks against Circle's real USDC on a local fork of Monad Testnet. They include signature and buyer-authorization binding, capped charges, principal refunds, full timeout refunds, replay rejection, withdrawal safety, confirmation-stage waits, deployment code checks and event reconciliation. Funding with real USDC used 282,450 gas, about 20% less than the earlier native-asset version; Monad charges the gas limit, so the client sends each write with an explicit, bounded headroom over its estimate. A separate encoding/integer oracle checked 128 commitments, 256 typed digests and 256 allocations for the earlier signing domain. No testnet contract is deployed. [Settlement contract and limits](docs/Attempt-and-Settlement.md).

## Design and next decision

- [Paid unit and acceptance boundary](docs/Paid-Unit.md)
- [Architecture](docs/LemmaX-Architecture.md)
- [Probability, cost, contribution and proposed API](docs/LemmaX-Math-and-API.md)
- [Business and benchmark requirements](docs/LemmaX-Business-Requirements.md)
- [Reuse review and testnet validation plan](docs/LemmaX-Build-Readiness-and-Reuse.md)
- [Blob-storage research](docs/LemmaX-Blob-Research.md)
- [Implemented library contract](docs/Implementation.md)
- [Retrieval and MCP integration](docs/Retrieval-and-MCP.md)
- [Private records, receipts and settlement](docs/Attempt-and-Settlement.md)
- [Monad settlement path, deployment and plan](docs/Monad-Settlement-Path.md)

The user agreed connector-principal refund for eligible failure, with actual separately quoted, capped execution/evaluation charges retained. Unused reserve is buyer-owned credit. An agent-controlled withdrawal bar with a minimum and subscription-aware cost comparisons are being specified. Withdrawal semantics, offer versions, tariffs, evaluator authority, timeouts and contract allocations remain to be frozen before funding is enabled. Workload billing allocation is implemented; live provider entitlement checks and quota reservation remain open. Two retrieval offers and their public MCP integration are implemented. Signed quote/receipt primitives and local Monad settlement are implemented. The user selected full timeout refund. The user selected USDC settlement, separate issuer and evaluator keys, Monad Testnet, equal offer prices, two deadline profiles and an execution-charge-only LemmaX fee. The user agreed demonstration tariffs and deadline profiles grounded in published reference prices and measured costs. The MCP server can quote, fund and report attempts through operator-configured purchase tools. Through them, `npm run demo:testnet` ran the success, eligible-failure and timeout attempts on Monad Testnet; every attempt settled as planned and the events reconcile with the private records. [Live run](docs/Monad-Settlement-Path.md#live-run-on-monad-testnet). Next: ERC-8004 identity, an authenticated remote transport and submission evidence. [Agreed terms, roles and plan](docs/Monad-Settlement-Path.md#6-agreed-demonstration-terms). No external partner is currently lined up.

## Repository hygiene

Private records, environment files and raw run directories are excluded. Before publication or push, scan staged changes and full history with gitleaks. The optional local pre-commit hook requires gitleaks; activate it with `git config core.hooksPath .githooks`.

The original project license remains to be selected. No earlier repository source code or model weights were copied into this first slice.
