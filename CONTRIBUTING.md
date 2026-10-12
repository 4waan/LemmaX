# Build on LemmaX

Start with the assessment library. It runs without a wallet, corpus, model API key or network connection. Add retrieval when you want to call the MCP tools. Add settlement when you want to follow a purchase through to its refund or payout.

Use Node.js 22.15 or newer for both packages. Run the following commands from the repository root:

```sh
npm ci --ignore-scripts
npm run demo
npm run demo:billing
npm test
npm run benchmark:verify
```

[`examples/assess.mjs`](examples/assess.mjs) is the smallest complete assessment request. It supplies the outcome, evidence, probability policy and cost assumptions explicitly. [`examples/billing.mjs`](examples/billing.mjs) compares usage billing with new and already-paid subscriptions. Both use illustrative inputs and send no transactions.

`npm test` runs the root Node test suite. `benchmark:verify` checks committed benchmark arithmetic and code identities; it does not download or rerun the corpus.

## Run retrieval and MCP

Retrieval uses the frozen public SciFact dataset. Python 3 prepares the publisher's archive. Original text and new run output belong in the ignored `private/` directory:

```sh
mkdir -p private
curl --fail --location https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip --output private/scifact.zip
python3 scripts/prepare-scifact.py --dataset private/scifact.zip --output private/scifact
export LEMMAX_SCIFACT_DIR="$PWD/private/scifact"
export LEMMAX_BENCHMARK_OUTPUT="$PWD/private/paired-run"
npm run demo:retrieval
npm run benchmark:retrieval
npm run mcp:check
```

The preparation script refuses an archive with the wrong checksum. `benchmark:retrieval` writes a new measured report under the configured output directory, leaving admitted repository evidence intact. `mcp:check` starts the stdio server and exercises it through the official MCP SDK.

For an interactive client, use the [MCP configuration and tool contracts](docs/Retrieval-and-MCP.md#connect-an-mcp-client). A fresh process with only `LEMMAX_SCIFACT_DIR` configured serves the public read-only tools. Full operator configuration, including the settlement address, issuer key, evaluator and spending caps, enables quote, fund and status tools. Keep stdout reserved for MCP messages.

## Find the boundary you are changing

- **Assessment and billing:** [`src/assessment.mjs`](src/assessment.mjs), [`src/beta.mjs`](src/beta.mjs) and [`src/billing.mjs`](src/billing.mjs) calculate forecasts and workload costs. Missing evidence remains unknown. Decimal forecasts cannot authorize spending.
- **Retrieval and public responses:** [`src/retrieval.mjs`](src/retrieval.mjs) ranks authorized sources; [`src/scifact.mjs`](src/scifact.mjs) admits the frozen dataset; [`src/directory.mjs`](src/directory.mjs) exposes known profiles and redacts operator contribution. [`src/mcp.mjs`](src/mcp.mjs) validates tool input.
- **Purchase and private evidence:** [`src/issuer.mjs`](src/issuer.mjs), [`src/purchase.mjs`](src/purchase.mjs) and [`src/evaluator.mjs`](src/evaluator.mjs) issue, fund and evaluate an attempt. [`src/attempt.mjs`](src/attempt.mjs) defines commitments, encryption and signed messages. Payment values are atomic integer strings.
- **Chain execution:** [`contracts/AttemptSettlement.sol`](contracts/AttemptSettlement.sol) enforces funding, settlement and payouts. [`src/settlement.mjs`](src/settlement.mjs), [`src/monad.mjs`](src/monad.mjs) and [`src/reconcile.mjs`](src/reconcile.mjs) simulate calls, confirm chain state and reconcile allocations.
- **Buyer approval and public audit:** [`src/guard.mjs`](src/guard.mjs) approves quote digests, [`src/privy-buyer.mjs`](src/privy-buyer.mjs) connects the wallet policy, and [`src/audit.mjs`](src/audit.mjs) reads audit findings. [`indexer/`](indexer/) reconstructs settlements using the shared rules and the hash-pinned [`rulebook/`](rulebook/).
- **Identity and feedback:** [`src/erc8004.mjs`](src/erc8004.mjs) and [`src/reputation.mjs`](src/reputation.mjs) prepare agent registrations and bounded feedback from settled attempts.
- **Web demo:** [`web/server.mjs`](web/server.mjs) serves the page, its purchase API and a read-only HTTP MCP endpoint. [`web/live.mjs`](web/live.mjs) connects the operator's wallet, evaluator and auditor.

The entry points assemble these modules. Keep dataset admission, evaluator authority and payment authorization on their owning side of the boundary. An MCP caller must not supply trusted evidence counts, private principals, keys or arbitrary storage paths.

## Check settlement and the auditor

Compile without deploying:

```sh
npm run contract:compile
```

If Solidity changes its interface, `npm run contract:abi` regenerates the checked-in ABI. Local lifecycle tests require official Anvil 1.8 or newer. Use `LEMMAX_ANVIL_BIN` when the binary is outside `PATH`:

```sh
npm run settlement:check
```

This deploys to a temporary local node under Monad execution rules. It generates local test accounts and uses a test token. `npm run settlement:fork-check` instead requires `LEMMAX_FORK_RPC_URL` and runs against Circle USDC on a local fork. Neither command broadcasts to Monad Testnet.

The auditor is a separate package. Match [CI](.github/workflows/checks.yml) when installing and generating its typed bindings:

```sh
npm --prefix indexer ci --ignore-scripts --legacy-peer-deps
npm --prefix indexer run codegen
npm --prefix indexer run typecheck
npm run auditor:test
```

Code generation and the auditor tests do not deploy a hosted GraphQL service. Use [`indexer/config.yaml`](indexer/config.yaml) and the [trust-loop guide](docs/Trust-Loop.md) for that boundary.

The indexer pins Envio and Vitest. Its scoped overrides select patched Express, query parsing and WebSocket dependencies while keeping their existing major versions. When updating them, verify a clean install, code generation, types and auditor behavior together. The pinned versions and override scope live in [`indexer/package.json`](indexer/package.json).

## Run funded demos deliberately

`npm run live` initializes the operator's funded web demo on Monad Testnet. Its `/mcp` endpoint is read-only, but visitors to its purchase API use the configured demo buyer and relayer. It is not a wallet-free retrieval preview or an authenticated private-company service.

Set `LEMMAX_STATE_DIR` to a durable, ignored directory to preserve daily budgets across restarts. A missing state file starts a new ledger; unreadable or malformed saved state stops startup rather than resetting spending counters. Run one instance against that state directory. The counters and queue are not a distributed spending ledger.

Per-visitor limits use the direct connection's address by default. Set `LEMMAX_TRUST_PROXY=true` only when every request comes through a trusted proxy that overwrites `X-Forwarded-For` and blocks direct access to the server. Otherwise a caller can choose its own forwarded address. Keep the default for direct local use.

`LEMMAX_DEMO_TARGET=fork npm run demo:loop` and `npm run live:check` rehearse purchases on a local fork. They need the prepared corpus, Anvil, a fork RPC and the configured role keys. The [operator guide](docs/Monad-Settlement-Path.md#7-testnet-roles-and-funding) describes those roles. Export settings in the process environment; these entry points do not load `.env` automatically.

Deployment and testnet loop scripts preview by default and require their documented broadcast flags to send transactions. Privy setup and ERC-8004 commands have separate effects. Read the [settlement path](docs/Monad-Settlement-Path.md) and [trust loop](docs/Trust-Loop.md) before using them. Do not put keys in command arguments or commit environment files.

## Make changes reviewable

Explain the changed behavior and its boundary. Add a test when it protects a failure case or a meaningful contract, then run the affected suite. Sensitive arithmetic and signing changes also need a check that does not repeat the implementation's assumptions. Existing code-bound oracle reports explain their scope and limits under [`verification/`](verification/).

Keep raw runs and private records outside tracked source. Before admitting generated evidence, scan it for credentials, check its source hashes and state what the run actually proves. Do not relabel a local or fork run as a live deployment.

Follow [AGENTS.md](AGENTS.md): no dates or timestamps in documentation prose, commit as `4waan`, and omit co-author trailers. Use versions, commit hashes and evidence links for provenance. Check relative links and scan staged changes plus full history with gitleaks before pushing. The optional hook is enabled with `git config core.hooksPath .githooks` and requires gitleaks.

For the reading order and the distinction between current guides and earlier research, see the [documentation index](docs/README.md).
