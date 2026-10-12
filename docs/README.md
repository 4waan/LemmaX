# Read LemmaX from the outside in

LemmaX compares bounded resource offers before an agent pays, then settles a purchase against an agreed outcome. The first implemented resource is a public benchmark search returning up to five source references. Read the [project README](../README.md) for the pitch and [CONTRIBUTING.md](../CONTRIBUTING.md) to run the code.

## Follow one purchase

Start with the [paid unit](Paid-Unit.md). It defines the result a buyer purchases and separates the refundable search price from execution and evaluation charges. Then read [retrieval and MCP](Retrieval-and-MCP.md) for the offer identifiers, measured results, dataset setup and tool inputs.

The [attempt and settlement guide](Attempt-and-Settlement.md) follows the money: private records, signed quotes, evaluator receipts, refunds and payouts. The [Monad settlement path](Monad-Settlement-Path.md) connects that lifecycle to deployment records, demonstration terms and operator roles.

The [trust loop](Trust-Loop.md) explains how the buyer's guard, wallet policy, public auditor and ERC-8004 records connect. Its auditor checks published settlement rules. It does not establish that a search result is relevant.

## Understand the computation

The [assessment library guide](Implementation.md) describes admitted evidence, probability policies, expected completion cost and subscription allocation. It explains why unknown evidence leaves a resource unranked and why forecasts are separate from executable payment terms.

The [architecture](LemmaX-Architecture.md) records the privacy boundary and the larger directory model. The public benchmark is the implemented entry point; authenticated access to private-company records is a separate boundary.

## Check a claim against its record

- [`benchmarks/retrieval-paired-results.json`](../benchmarks/retrieval-paired-results.json) contains the paired retrieval outcomes and frozen code/data identities.
- [`deployments/`](../deployments/) identifies deployed contracts. A deployment record alone does not prove a full purchase loop ran there.
- [`verification/`](../verification/) contains local checks, fork rehearsals and recorded live runs. Read each report's target, source identities and limitations before extending its claim.
- [`rulebook/lemmax-rulebook-v1.json`](../rulebook/lemmax-rulebook-v1.json) defines the demonstration's public audit rules. Its hash is part of the buyer's approval boundary.
- [`package.json`](../package.json), [`indexer/package.json`](../indexer/package.json) and [CI](../.github/workflows/checks.yml) define the commands and checks developers should reproduce.

The current code and rulebook define behavior. Evidence records show what was exercised. Guides explain those boundaries; earlier research is background rather than an alternative implementation contract.

## Earlier research

These notes preserve the decisions behind the build. Their proposed APIs and status statements may precede the current implementation:

- [Mathematics and API](research/LemmaX-Math-and-API.md): the probability, completion-cost and contribution model.
- [Business requirements](research/LemmaX-Business-Requirements.md): candidate capabilities and the choice of a bounded retrieval benchmark.
- [Build readiness and reuse](research/LemmaX-Build-Readiness-and-Reuse.md): evidence requirements and the review of earlier Lemma assets.
- [Blob storage](research/LemmaX-Blob-Research.md): storage tradeoffs and why blob publication is not an MVP dependency.

Dataset, package and tooling terms are recorded in [THIRD_PARTY.md](../THIRD_PARTY.md).
