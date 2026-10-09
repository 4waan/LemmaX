# LemmaX

LemmaX is a directory for comparing versioned resource offers by a scoped outcome probability and expected completion cost. Explicit contribution accounting governs which services LemmaX can sustainably offer.

The initial capability is authorized source retrieval through a connector/MCP tool. The working demo purchase is one bounded retrieval attempt. Company-approved evaluation keeps detailed evidence private; Monad will hold the attempt commitment and financial settlement.

## Current implementation

This first slice implements a deterministic, dependency-free assessment library:

- Beta posterior means and equal-tail credible intervals from explicitly configured, already admitted evidence.
- Evidence/profile/version matching, freshness, completeness and independence guards.
- Null forecasts and ranks for missing or inapplicable evidence.
- Expected completion cost, probability-only cost intervals and direct-completion savings.
- Contribution and service-availability gates, without changing probabilities to favor commission.
- Deterministic cost ordering for eligible, evidenced, commercially available offers in one currency.

There is a synthetic CLI demonstration and a separately recorded public SciFact lexical baseline. HTTP/MCP transport, trusted evidence admission, retrieval offers, signatures, wallets and Monad deployment are subsequent work. No customer adoption, production prices or revenue forecast is claimed.

## Run locally

Use Node.js 22 or newer. No package installation or model API key is needed.

```sh
npm test
npm run demo
npm run benchmark:verify
```

`npm run demo` marks every offer, count, tariff and policy as synthetic. Its numerical values are not the measured SciFact result or selected commercial defaults. `npm run benchmark:verify` independently recomputes stored relevance metrics and checks the measured runner hash; it does not rerun retrieval or certify the stored labels.

To rerun retrieval, obtain the public SciFact dataset from the source documented in [the benchmark runner](benchmarks/scifact_bm25.py), then pass local paths using its `--help` instructions. The dataset and document text are not vendored. [Dataset attribution and rights](THIRD_PARTY.md).

## Boundaries

The library consumes authorized server-side evidence snapshots and configured economics. It does not authenticate snapshots, perform eligibility checks, or accept client-supplied counts as trusted evidence. A future HTTP/MCP wrapper must load those inputs from its own admitted store and enforce company access/disclosure policy.

Results include internal contribution information. A public API must apply the intended disclosure policy rather than expose the internal result object directly. Private company evidence must not be returned to another tenant. A public benchmark forecast cannot stand in for company integration acceptance.

Forecast money uses finite decimal numbers. Actual quotes and settlement need integer atomic units and separate authorization. No forecast is permission to spend or a settlement verdict. The initial Beta implementation supports each shape parameter at least 0.5 and total posterior shape at most 10,000; this is a numerical implementation limit, not a selected evidence policy.

## Verification

The first slice has 23 passing Node tests. A separate Python Decimal oracle checked 225 Beta quantiles and 400 monetary expectations against different formulas. The maximum checked CDF difference was approximately `3.07e-12`; the maximum monetary difference was `3e-13`. This is numerical verification, not an independent human audit or probability calibration. [Verification report](verification/numerical-verification.json).

The earlier SciFact run hit a relevant source in the top five on 224 of 300 queries, or 74.67%. It used no paid API calls or model training. That is one untuned lexical baseline, not a model comparison, enterprise acceptance result, or API capacity claim. [Measured report](benchmarks/scifact-bm25-results.json).

## Design and next decision

- [Paid unit and acceptance boundary](docs/Paid-Unit.md)
- [Architecture](docs/LemmaX-Architecture.md)
- [Probability, cost, contribution and proposed API](docs/LemmaX-Math-and-API.md)
- [Business and benchmark requirements](docs/LemmaX-Business-Requirements.md)
- [Reuse review and testnet validation plan](docs/LemmaX-Build-Readiness-and-Reuse.md)
- [Blob-storage research](docs/LemmaX-Blob-Research.md)
- [Implemented library contract](docs/Implementation.md)

The immediate policy decision is whether eligible failure refunds connector principal only or the entire quoted bill. Offer versions, tariffs, evaluator authority, timeouts and contract allocations remain to be frozen before funding is enabled. No external partner is currently lined up.

## Repository hygiene

Private records, environment files and raw run directories are excluded. Before publication or push, scan staged changes and full history with gitleaks. The optional local pre-commit hook requires gitleaks; activate it with `git config core.hooksPath .githooks`.

The original project license remains to be selected. No earlier repository source code or model weights were copied into this first slice.
