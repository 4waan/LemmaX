# Private attempts, signed receipts and settlement

Package version 0.3.0 added private-record commitments/encryption, signed quote and receipt primitives, exact integer allocation, and a native-asset Solidity settlement prototype. Version 0.4.0 adds the Monad client, reconciler and deployment script described in [the Monad settlement path](Monad-Settlement-Path.md). The public MCP server remains read-only and non-fundable. No contract has been deployed to Monad Testnet.

The user selected full refund when no valid evaluator verdict is submitted by the settlement deadline. Success pays connector principal and actual capped execution/evaluation charges. Eligible failure refunds principal and retains only those actual capped charges. Timeout credits the entire locked amount to the buyer, with no service deductions.

## Private record and commitment

`normalizeAttemptRecord` requires the exact `private-attempt/v1` fields: offer/outcome/context/task/principal/access/terms references, input and source-version digests, source/retry limits, execution deadline, principal and service caps. Unknown fields and missing fields are rejected. References are well-formed UTF-8, at most 1024 bytes, without control characters. Source count is one to five; retry count is explicitly supplied. References identify private data rather than authorizing access to it.

All financial amounts and epoch-second deadlines are canonical unsigned decimal strings. Money is bounded to uint256; times to uint64. No floating-point conversion or automatic denomination choice is permitted. Digest fields use nonzero `0x`-prefixed bytes32. The versioned input/source profile must declare the digest meaning. The public example uses Keccak for query input and the prepared corpus SHA-256 for its source version.

`attemptRecordHash` uses ABI encoding of the schema/reference hashes, digests and bounded integers in a fixed field order. JSON key order does not affect it. `commitAttemptRecord` binds that hash to a private random salt and the `LemmaX/attempt-commitment/v1` domain. Evidence commitments use a separate domain. Use `newAttemptId` or another cryptographically secure generator for fresh salts; keep salts private. The low-level commitment helper checks salt shape, not entropy.

`sealAttemptRecord` uses AES-256-GCM, a fresh random 12-byte IV and a fresh commitment salt. The salt is encrypted with the record. Schema and commitment are authenticated as associated data. `openAttemptRecord` requires the encryption key and an externally expected commitment, authenticates the envelope, and recomputes the committed record before returning it. It does not trust an envelope's own commitment as the external reference.

The caller supplies and retains the 32-byte encryption key. Company key custody, access revocation, storage retention, audit permissions and record persistence are not implemented. Demo keys exist only in memory. Encryption does not establish company approval or evaluator honesty. Node's [authenticated-encryption API](https://nodejs.org/api/crypto.html) supplies the cryptographic primitive.

## Quote and evaluator authority

The EIP-712 domain is `LemmaXAttemptSettlement`, version `1`, with explicit chain ID and verifying-contract address. [Typed-signing specification](https://eips.ethereum.org/EIPS/eip-712). Quotes include attempt ID, record commitment, policy hash, issuer, buyer, three payees, evaluator signer, asset, principal/caps, funding expiry, execution deadline, settlement deadline and timeout mode. There are no hidden tariff or time defaults.

The policy hash names `LemmaX/principal-refund-and-timeout-refund/v1`; timeout mode is only `refund_all`. `bindRecordToQuote` checks the private commitment and duplicated monetary/deadline fields before a quote is signed. `verifyQuote` requires an externally approved issuer and checks signature/expiry. An issuer address named by an untrusted quote is not sufficient authority by itself.

The deployed prototype would have one immutable approved quote issuer. The buyer must fund their own exact quote through their wallet. Funding freezes the quote, including evaluator and payout destinations. Company approval of that evaluator is an upstream business/access check; the chain sees the approved address and the buyer's consent. No ERC-1271 smart-wallet signer or key-rotation registry is implemented in this slice.

Receipts bind attempt ID, full domain-bound quote digest, randomized evidence commitment, outcome, consumed service amounts, completion time and evaluation time. Outcomes are `success`, `eligible_failure`, or `unresolved`. An unresolved receipt cannot settle. The evaluator must attest eligibility and actual attributable consumption under the private terms. A signature authenticates the attestation, not its truth or ML execution.

Offchain verification checks attempt/quote binding, frozen evaluator, funding/completion/evaluation ordering, execution/settlement deadlines and charge caps. Its ECDSA input checks match Solidity's canonical 65-byte, low-s, v=27/28 boundary. Pure verification is stateless and does not consume a receipt. The chain's terminal attempt state supplies replay protection.

Failure eligibility and dispute/correction policy for real company tasks remain open. The retrieval demo treats a relevance miss with otherwise valid public conformance as eligible failure. That demonstration rule is not a selected customer policy. An approved evaluator can issue conflicting statements; the prototype accepts the first valid onchain settlement and has no reversal or arbitration path.

## Exact allocation and onchain states

Let `P` be principal, `E` execution cap, `V` evaluation cap, and `e`, `v` the signed actual charges within those caps. Funding is `P+E+V`.

- Success: connector credit `P`, executor credit `e`, evaluator credit `v`, buyer credit `(E-e)+(V-v)`.
- Eligible failure: connector credit zero, service credits `e` and `v`, buyer credit `P+(E-e)+(V-v)`.
- Timeout without an accepted verdict: only buyer credit `P+E+V`.

The contract permits `None -> Funded -> SettledSuccess`, `SettledFailure`, or `RefundedTimeout`. A consumed attempt ID cannot be funded again. A settled or timed-out attempt cannot settle/refund again. Native-asset funding must exactly match the signed total; ERC-20 funding is rejected. Zero-priced quotes are possible if explicitly signed, so payment state alone does not prove commercial demand.

A valid receipt may be submitted through the settlement deadline inclusive. Timeout becomes available strictly after it. A receipt signed earlier but submitted after the deadline cannot override the full refund. Any caller can relay a valid receipt or trigger an expired refund, but cannot change frozen recipients. No signer can replace funded terms.

Settlement records credits before any payout. Owners explicitly withdraw their own credit to a destination they authorize in that transaction. Failed sends revert the accounting; a reentrancy guard protects withdrawals. Automated minimum/bar scheduling remains open and is not inferred from this manual primitive. Ledger refunds exclude transaction gas paid by the submitting wallet.

Locked funds and owner credits are separately accounted. The contract has no administrative drain or issuer-switch function. Forced/donated native balance can exceed accounted liabilities; it does not become spendable buyer credit. Public wallets, destinations, amounts, deadlines and transaction timing remain visible. Commitments hide detailed task data, not those unavoidable financial relationships.

Settlement state is a payment event. It does not automatically admit a new benchmark observation, treat timeout as a labeled relevance failure, or publish ERC-8004 feedback. Evidence admission and authorized reputation export remain separate.

## Run and verification

```sh
npm ci --ignore-scripts
npm test
export LEMMAX_CONTRACT_OUTPUT="$PWD/private/contract-build"
npm run contract:compile
npm run settlement:check
```

`settlement:check` requires official Anvil v1.8 or newer. It binds only to localhost, selects Monad execution with `MonadTen`, uses a local chain ID and accounts with generated in-memory test keys, and shuts down the node when finished. `LEMMAX_ANVIL_BIN` can select an isolated binary without replacing the user's installed toolchain. [Monad's Foundry guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/foundry).

The compiler is pinned to Solidity 0.8.37 with an Osaka target. OpenZeppelin supplies typed hashing, canonical ECDSA recovery and reentrancy protection. The build-only `tmp` dependency is explicitly pinned to its corrected version; the full npm audit reports zero advisories. Compiler artifacts belong in ignored/private output, not a committed deployment claim.

With the prepared public corpus, `npm run demo:attempt` signs and verifies a real successful and failed retrieval case, while keeping keys, record plaintext and salts out of its output. Its charge amounts are illustrative, its contract domain is an undeployed local fixture, and it moves no funds.

The Node suite has 63 passing tests. The local Monad lifecycle script passed 64 checks through the settlement client and deployment script, including JS/Solidity digest agreement, funding/authority/caps, exact allocations, timeout, duplicate operations, failed transfer rollback, withdrawal ownership, reentrant receiver and solvency. [Local lifecycle report](../verification/settlement-check.json).

A separate Python word-encoding oracle with Rust Keccak checked 128 record commitments, 256 typed digests and 256 exact allocations. [Oracle report](../verification/attempt-verification.json). Feature tests and implementation share an author/session. These are different-formula checks, not an independent human security audit, evaluation-honesty proof or key-custody review.

## Remaining testnet work

Choose the real company-approved evaluator and quote issuer, finalize failure eligibility and dispute terms, select actual tariffs/deadlines, and connect persistent company-controlled records. The deployment script, settlement client and reconciler are implemented and unused against a public network; a deployer key and the exact demonstration budget remain to be supplied. [Monad settlement path](Monad-Settlement-Path.md). The public MCP server needs a separately authenticated, wallet-authorized purchase path before it can issue fundable customer quotes. No wallet credentials or testnet funds have been used by this work.
