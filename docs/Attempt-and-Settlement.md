# Private attempts, signed receipts and settlement

Package version 0.3.0 added private-record commitments/encryption, signed quote and receipt primitives, exact integer allocation, and a native-asset Solidity settlement prototype. Version 0.4.0 added the Monad client, reconciler and deployment script. Version 0.5.0 settles in Circle USDC: the buyer funds with an EIP-3009 authorization bound to the quote, and the contract stores only the quote digest. Version 0.6.0 adds the operator-enabled MCP purchase path. [Monad settlement path](Monad-Settlement-Path.md).

Contract version 2 is deployed and source-verified on Monad Testnet, where the success, eligible-failure and timeout attempts ran to their planned ends. Contract version 3 is the current contract. It adds automatic payouts and is deployed and source-verified at [`0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7`](https://testnet.monadvision.com/address/0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7). [Deployment record](../deployments/AttemptSettlement-v3.testnet.json). The default public MCP server stays read-only and non-fundable.

We refund the full locked amount when no valid evaluator verdict arrives by the settlement deadline, so a silent checker never costs the buyer anything. Success pays connector principal and actual capped execution/evaluation charges. Eligible failure refunds principal and retains only those actual capped charges. Timeout credits the entire locked amount to the buyer, with no service deductions.

## Private record and commitment

`normalizeAttemptRecord` requires the exact `private-attempt/v1` fields: offer/outcome/context/task/principal/access/terms references, input and source-version digests, source/retry limits, execution deadline, principal and service caps. Unknown fields and missing fields are rejected. References are well-formed UTF-8, at most 1024 bytes, without control characters. Source count is one to five; retry count is explicitly supplied. References identify private data rather than authorizing access to it.

All financial amounts and epoch-second deadlines are canonical unsigned decimal strings. Money is bounded to uint256; times to uint64. No floating-point conversion or automatic denomination choice is permitted. Digest fields use nonzero `0x`-prefixed bytes32. The versioned input/source profile must declare the digest meaning. The public example uses Keccak for query input and the prepared corpus SHA-256 for its source version.

`attemptRecordHash` uses ABI encoding of the schema/reference hashes, digests and bounded integers in a fixed field order. JSON key order does not affect it. `commitAttemptRecord` binds that hash to a private random salt and the `LemmaX/attempt-commitment/v1` domain. Evidence commitments use a separate domain. Use `newAttemptId` or another cryptographically secure generator for fresh salts; keep salts private. The low-level commitment helper checks salt shape, not entropy.

`sealAttemptRecord` uses AES-256-GCM, a fresh random 12-byte IV and a fresh commitment salt. The salt is encrypted with the record. Schema and commitment are authenticated as associated data. `openAttemptRecord` requires the encryption key and an externally expected commitment, authenticates the envelope, and recomputes the committed record before returning it. It does not trust an envelope's own commitment as the external reference.

The caller supplies and retains the 32-byte encryption key. Company key custody, access revocation, storage retention, audit permissions and record persistence are not implemented. Demo keys exist only in memory. Encryption does not establish company approval or evaluator honesty. Node's [authenticated-encryption API](https://nodejs.org/api/crypto.html) supplies the cryptographic primitive.

## Quote and evaluator authority

The EIP-712 domain is `LemmaXAttemptSettlement`, version `2`, with explicit chain ID and verifying-contract address. Version `1` signatures from the native-asset prototype do not verify against it. [Typed-signing specification](https://eips.ethereum.org/EIPS/eip-712). Quotes include attempt ID, record commitment, policy hash, issuer, buyer, three payees, evaluator signer, asset, principal/caps, funding expiry, execution deadline, settlement deadline and timeout mode. There are no hidden tariff or time defaults.

The policy hash names `LemmaX/principal-refund-and-timeout-refund/v1`; timeout mode is only `refund_all`. `bindRecordToQuote` checks the private commitment and duplicated monetary/deadline fields before a quote is signed. `verifyQuote` requires an externally approved issuer and checks signature/expiry. An issuer address named by an untrusted quote is not sufficient authority by itself.

The deployed contract has one immutable approved quote issuer and one immutable settlement token. The buyer consents by signing an EIP-3009 `ReceiveWithAuthorization` for the exact funding total, payable to the settlement contract, whose nonce is the domain-bound quote digest. That signature commits the buyer to every quote term, and the token refuses a second use. Any wallet can relay funding; the buyer needs no native gas. Funding freezes the quote, including evaluator and payout destinations. Company approval of that evaluator is an upstream business/access check; the chain sees the approved address and the buyer's consent. Circle USDC accepts ERC-1271 smart-wallet signatures for this authorization, but no smart-wallet buyer is exercised and no key-rotation registry is implemented.

Receipts bind attempt ID, full domain-bound quote digest, randomized evidence commitment, outcome, consumed service amounts, completion time and evaluation time. Outcomes are `success`, `eligible_failure`, or `unresolved`. An unresolved receipt cannot settle. The evaluator must attest eligibility and actual attributable consumption under the private terms. A signature authenticates the attestation, not its truth or ML execution.

Offchain verification checks attempt/quote binding, frozen evaluator, funding/completion/evaluation ordering, execution/settlement deadlines and charge caps. Its ECDSA input checks match Solidity's canonical 65-byte, low-s, v=27/28 boundary. Pure verification is stateless and does not consume a receipt. The chain's terminal attempt state supplies replay protection.

Failure eligibility and dispute/correction policy for real company tasks remain open. The retrieval demo treats a relevance miss with otherwise valid public conformance as eligible failure. That demonstration rule is not a selected customer policy. An approved evaluator can issue conflicting statements; the prototype accepts the first valid onchain settlement and has no reversal or arbitration path.

## Exact allocation and onchain states

Let `P` be principal, `E` execution cap, `V` evaluation cap, and `e`, `v` the signed actual charges within those caps. Funding is `P+E+V`.

- Success: connector credit `P`, executor credit `e`, evaluator credit `v`, buyer credit `(E-e)+(V-v)`.
- Eligible failure: connector credit zero, service credits `e` and `v`, buyer credit `P+(E-e)+(V-v)`.
- Timeout without an accepted verdict: only buyer credit `P+E+V`.

The contract permits `None -> Funded -> SettledSuccess`, `SettledFailure`, or `RefundedTimeout`. A consumed attempt ID cannot be funded again. A settled or timed-out attempt cannot settle/refund again. Funding must transfer exactly the signed total of the contract's token; a quote naming another asset is rejected. Only the quote digest, funding time and state are stored; settlement and refund take the quote back as calldata and reject any quote that does not match the stored digest. Zero-priced quotes are possible if explicitly signed, so payment state alone does not prove commercial demand.

A valid receipt may be submitted through the settlement deadline inclusive. Timeout becomes available strictly after it. A receipt signed earlier but submitted after the deadline cannot override the full refund. Any caller can relay a valid receipt or trigger an expired refund, but cannot change frozen recipients. No signer can replace funded terms.

Settlement records credits before any payout. An owner can withdraw its own credit to a destination it authorizes in that transaction, other than the contract itself. A transfer the token refuses during `withdraw`, such as to a blocked address, reverts the accounting. Version 3 also pays an owner's whole credit inside the settlement or refund transaction once it reaches the owner's bar, which is at least 0.01 USDC. A refused payout restores the credit and emits `PayoutDeferred`, so it cannot block settlement, and anyone can retry it with `sweep`. A reentrancy guard protects every state-changing entry point. Ledger refunds exclude transaction gas paid by the submitting wallet.

Locked funds and owner credits are separately accounted. The contract has no administrative drain or issuer-switch function. Tokens sent directly to the contract can exceed accounted liabilities; they do not become spendable credit. A USDC blocklist or pause applied to the contract or a participant would stop transfers; that is an issuer-level dependency of the chosen asset. Public wallets, destinations, amounts, deadlines and transaction timing remain visible. Commitments hide detailed task data, not those unavoidable financial relationships.

Settlement state is a payment event. It does not automatically admit a new benchmark observation, treat timeout as a labeled relevance failure, or publish ERC-8004 feedback. Evidence admission and authorized reputation export remain separate.

## Run and verification

```sh
npm ci --ignore-scripts
npm test
export LEMMAX_CONTRACT_OUTPUT="$PWD/private/contract-build"
npm run contract:compile
npm run settlement:check
LEMMAX_FORK_RPC_URL=https://testnet-rpc.monad.xyz npm run settlement:fork-check
```

Both checks require official Anvil v1.8 or newer. `settlement:check` uses a local FiatToken test double; `settlement:fork-check` uses Circle's deployed USDC on a local fork of Monad Testnet and mints buyer funds through an impersonated master minter. It binds only to localhost, selects Monad execution with `MonadTen`, uses a local chain ID and accounts with generated in-memory test keys, and shuts down the node when finished. `LEMMAX_ANVIL_BIN` can select an isolated binary without replacing the installed toolchain. [Monad's Foundry guidance](https://docs.monad.xyz/tooling-and-infra/toolkits/foundry).

The compiler is pinned to Solidity 0.8.37 with an Osaka target. OpenZeppelin supplies typed hashing, canonical ECDSA recovery, safe token transfers and reentrancy protection. The build-only `tmp` dependency is explicitly pinned to its corrected version; the full npm audit reports zero advisories. Compiler artifacts belong in ignored/private output, not a committed deployment claim.

With the prepared public corpus, `npm run demo:attempt` signs and verifies a real successful and failed retrieval case, while keeping keys, record plaintext and salts out of its output. It also signs the buyer's USDC funding authorization under the testnet token's domain. Its charge amounts are illustrative, its settlement address is an undeployed placeholder, and it moves no funds.

The Node suite (`npm test`) covers the client side. Against contract version 3, the local Monad lifecycle script passes 80 checks and the testnet-fork script 77, through the settlement client and deployment script. They cover JS/Solidity digest agreement, issuer, buyer and evaluator authority, funding caps, exact allocations, timeout, duplicate operations, refused transfers, withdrawal ownership, automatic payouts and solvency. [Local report](../verification/settlement-check.json), [fork report](../verification/settlement-fork-check.json).

A separate Python word-encoding oracle with Rust Keccak checked 128 record commitments, 256 typed digests and 256 exact allocations. [Oracle report](../verification/attempt-verification.json). That oracle predates the version `2` domain; JS and Solidity typed digests are now compared directly in both lifecycle checks. Feature tests and implementation share an author/session. These are different-formula checks, not an independent human security review, evaluation-honesty proof or key-custody review.

## Before customer use

The demonstration terms are fixed and the version 2 testnet run is complete. The testnet run used the operator's demonstration roles and testnet funds. Customer use still needs a real company-approved evaluator and quote issuer, failure eligibility and dispute terms, and persistent company-controlled records. It also needs an authenticated, wallet-authorized remote transport. Until then, fundable quotes come only from an operator-configured server. [Monad settlement path](Monad-Settlement-Path.md).
