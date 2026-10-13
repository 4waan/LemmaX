# Public retrieval connectors and MCP integration

This slice runs two connector offers on the same frozen public corpus. It uses no training or paid model inference. By default it is a read-only local integration; an operator-configured server adds the purchase tools described in the [Monad settlement path](Monad-Settlement-Path.md).

## Offers and output

The offers are `lemmax/bm25-source-retrieval/v1` and `lemmax/tfidf-source-retrieval/v1`. Both tokenize lowercase ASCII alphanumeric runs from title and text. Neither uses stemming, stopword removal, embeddings or tuning on test outcomes.

BM25 uses `k1=1.2`, `b=0.75` and ignores repeated query terms. TF-IDF uses sublinear term frequency `1+log(tf)`, smoothed IDF `1+log((1+N)/(1+df))` and cosine normalization. Query terms absent from the corpus still contribute to the query norm. Equal scores sort by source ID. These are distinct baseline connector configurations, not third-party commercial connectors or proof of market demand.

Each result contains up to five references with `sourceRef`, `sourceVersion`, `location`, `rank` and a method-specific score. Scores are ranking values, not probabilities and not comparable across methods. Query input is limited to 2048 characters and 256 token occurrences. The index freezes copied source metadata and builds statistics only from documents authorized for its configured principal. Hidden documents cannot change visible IDF or scores.

The public principal is fixed to the public SciFact corpus. The library requires explicit authorization and matching source versions, but these are trusted operator inputs rather than authentication proofs. The MCP server cannot load private corpora, select a caller-supplied principal, or import paths/URLs through tools. Private/company deployments need a separate authenticated evidence and document boundary.

## Measured comparison

The frozen test contains 5183 documents and 300 labeled query cases. Success is at least one labeled relevant source in the top five. The same-ID exclusion used by the earlier baseline is applied to benchmark replay only. Ordinary free-text search does not know a benchmark query ID.

- BM25: 224 successes out of 300, observed hit rate 74.67%.
- TF-IDF: 230 successes out of 300, observed hit rate 76.67%.
- Paired outcomes: both succeeded on 217 cases; BM25 alone on seven; TF-IDF alone on thirteen; both failed on 63.

This small measured difference does not establish general superiority. The report records local query latency, CPU consumption, index build time and heap delta. Timing covers synchronous scoring/sorting in one local process, rather than a hosting tariff, API SLA or distributed capacity claim. Monetary cost remains unknown until a hosting tariff is supplied. Zero paid API calls does not mean hosting and engineering are free.

Before evaluating either offer, queries were grouped by shared gold sources or identical normalized query text. Selecting the first query per connected component produces 247 representatives. This removes known overlap, but does not establish independence between scientific topics or calibration on future customer tasks.

[Paired measured report](../benchmarks/retrieval-paired-results.json). [Separate Python verification](../verification/retrieval-verification.json). Derived benchmark records retain [SciFact attribution and data terms](../THIRD_PARTY.md).

## Probability and pricing disclosure

`public-evidence` returns observed hit rates and leaves model forecasts/cost ranks unknown. Statistical independence is not established, and this scenario applies no tariff; the `demo-terms-*` scenarios price the demonstration USDC terms.

`illustrative-workload-cost/v1` explicitly treats the 247 representatives as independent and applies a uniform Beta prior. It illustrates conditional posterior means and cost ranking using synthetic workload, tariffs and operator terms. Its independence assumption, missing calibration, `DEMO_UNITS` currency and non-fundable status are returned with the response. These are not selected production policies or a customer-specific promise.

The conditional model uses 184 representative BM25 successes and 189 representative TF-IDF successes. It does not treat all repeated/overlapping queries as independent evidence. Probabilities are separate success events, so they do not sum to one. Arbitrary-query retrieval returns no task-specific probability. Benchmark replay reports an observed outcome and adds no new evidence.

Both assessment paths redact internal operator contribution. A caller selects only a known profile and optional fixed demonstration scenario. It cannot submit admitted counts, estimator policy, prices, margin, permissions or source versions.

## Reproduce locally

Use Node.js 22 or newer and Python 3 for archive preparation. Install the pinned MCP runtime and schema packages:

```sh
npm ci --ignore-scripts
```

Obtain the archive from the [BEIR dataset publisher](https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip). Keep the archive and prepared original text outside tracked source. The preparation script verifies the published archive checksum and reads only exact expected members, without extracting archive paths.

```sh
python3 scripts/prepare-scifact.py --dataset /path/to/scifact.zip --output private/scifact
export LEMMAX_SCIFACT_DIR="$PWD/private/scifact"
export LEMMAX_BENCHMARK_OUTPUT="$PWD/private/paired-run"
npm run benchmark:retrieval
npm run benchmark:verify
npm run demo:retrieval
npm run mcp:check
```

`private/` is ignored. A rerun writes its full measured report there and does not silently replace admitted repository evidence. Scan any run record before deliberately admitting it. The public server verifies the committed measured report against frozen code/data identities before startup. Startup refuses missing or modified prepared dataset members.

The separate Python oracle checked all 300 top-five rankings for both offers. BM25 matched the earlier independent Python baseline. TF-IDF matched full-vector cosine enumeration; maximum checked score difference was approximately `2.78e-16`. A separate adjacency-graph calculation matched all 247 representative groups. This does not audit original labels or establish population independence.

## Connect an MCP client

Run `node scripts/mcp-server.mjs` through a client's stdio transport, with `LEMMAX_SCIFACT_DIR` set by the operator. Keep stdout exclusively for protocol messages. The pinned [official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) handles negotiation and transport. The web demo also serves these read-only tools at `/mcp` using Streamable HTTP, with an optional auditor check. Its separate purchase API uses the operator's configured demo buyer. Authenticated access to private-company resources is not implemented.

Example client configuration, with paths replaced by the operator:

```json
{
  "mcpServers": {
    "LemmaX": {
      "command": "node",
      "args": ["/path/to/LemmaX/scripts/mcp-server.mjs"],
      "env": { "LEMMAX_SCIFACT_DIR": "/path/to/prepared/scifact" }
    }
  }
}
```

The five read-only tools, always present, are:

- `lemma_list_offers`: lists both offers, public profile and measured hit rates.
- `lemma_assess`: takes `profileRef: "beir-scifact-test-source-hit5/v1"` and optional scenario reference.
- `lemma_retrieve`: takes an exact `offerRef` and free-text `query`; returns versioned references.
- `lemma_read_source`: resolves a permitted `sourceRef` and optional integer `offset` to at most 1000 characters plus bounded title/provenance. Returned source text is data, not instructions or a generated answer.
- `lemma_run_benchmark_case`: takes `offerRef` and a known `caseRef`; replays its frozen public relevance check.

With an auditor configured, `lemma_verify_attempt` checks one attempt against the published rulebook. With an operator purchase desk, the server adds `lemma_quote_attempt`, `lemma_fund_attempt` and `lemma_attempt_status` ([Monad settlement path](Monad-Settlement-Path.md#purchase-path)). When the operator also sets the checker's key (`EVALUATOR_PRIVATE_KEY`), it adds `lemma_deliver_attempt`: the checker named on the bill runs the bought search, signs whether a relevant source came back, and settles the attempt on Monad in one transaction. It returns the source references, the verdict, each party's share of that settlement and the transaction, and reports progress while it works.

### The agent's wallet

The buyer side runs as its own MCP server, `node scripts/wallet-server.mjs` (`npm run mcp:wallet`), next to the LemmaX server in the same client. It has two tools:

- `wallet_status`: the wallet's address, USDC and MON balances, and the one thing its policy may sign.
- `wallet_sign_bill`: takes the `quote`, `issuerSignature` and `buyerAuthorization` that `lemma_quote_attempt` returned, and optionally the `lastSettlementBlock` from the previous delivery. The buyer's guard checks the issuer's signature, the published terms and the public auditor's record first; the wallet policy then signs only that bill's digest, paid to the settlement contract. A refusal is an ordinary answer naming the guard or the wallet policy and the reasons.

It reads the settlement contract (`LEMMAX_SETTLEMENT_ADDRESS`, contract version 3 by default) and the auditor (`LEMMAX_AUDITOR_URL`, otherwise the same rules over Monad logs). It signs through the Privy server wallet when `PRIVY_APP_ID`, `PRIVY_APP_SECRET` and the wallet record are present, otherwise through the local rehearsal of the same policy rule with `BENCHMARK_BUYER_PRIVATE_KEY`.

A full purchase from an agent is then `lemma_list_offers`, `lemma_assess`, `lemma_quote_attempt`, `wallet_sign_bill`, `lemma_fund_attempt` (which returns at Verified), `lemma_deliver_attempt`, and optionally `lemma_verify_attempt`.

All tools reject additional unrecognized input fields. Unknown offers, profiles, cases and sources fail without exposing local paths or stack traces. Reading source excerpts is limited to public benchmark content and carries the dataset license. No customer documents or evidence are served.

The real SDK smoke check compares rankings and outcomes through a spawned stdio server. It checks 100 requests with one request in flight and another 100 with a window of four. Server scoring remains synchronous; queued requests are not worker parallelism. This is a bounded local integration/load probe, not sustained production throughput or adoption by an outside team. [Recorded smoke run](../verification/mcp-smoke.json).

## Next boundary

The directory and retrieval flow are usable locally. The operator's purchase path ran three attempts on Monad Testnet with contract version 2, under the demonstration terms. [Live run](Monad-Settlement-Path.md#live-run-on-monad-testnet). Contract version 3 adds automatic payouts. Live subscription entitlement checks and an authenticated remote transport are the next steps. The public benchmark should not substitute for another team's actual integration task.
