# The LemmaX trust loop on Monad

Phase 4 turns the settlement path into a trust loop that an AI agent holding only USDC can use without MON, without trusting LemmaX's word, and without a human babysitting it. Each piece has one job, and each one depends on the others.

## 1. The Monad problem: stranded agent funds

Paying is already gasless on Monad: Monad's x402 facilitator and LemmaX both relay EIP-3009 authorizations, so a buyer funds an attempt with a signature. The return leg was not. Refunds and earnings held by a contract can only be withdrawn by a transaction the owner pays for in MON. On Monad that is harder than it looks: the full gas limit is charged rather than the gas used, accounts keep a 10 MON reserve for value transfers, delegated (EIP-7702) accounts have no emptying exception, Alchemy disables 7702 user operations on Monad for that reason, and Circle Paymaster is not deployed on Monad. [Monad gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing), [reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance), [Monad x402 guide](https://docs.monad.xyz/guides/x402).

**Contract version 3 pays credit out automatically.** When a settlement or refund brings an owner's credit to its bar (at least 0.01 USDC), the whole credit is transferred in the same transaction, which LemmaX's relayer already pays for. A refused transfer (a blocked payee or a paused token) restores the credit and emits `PayoutDeferred`, so it can never block a settlement; anyone can retry with `sweep`. An owner may route payouts elsewhere or raise its bar with one signed `PayoutInstruction` that anyone can relay (EOA or ERC-1271 signatures). `withdraw` remains for owners who hold MON. Funding also publishes the quote's public terms in `AttemptTerms`, and the contract refuses an issuer that names itself evaluator. [Contract](../contracts/AttemptSettlement.sol).

Deployed on Monad Testnet at [`0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7`](https://testnet.monadvision.com/address/0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7) with an exact Sourcify match. Checked locally with Monad execution rules (80 checks) and against Circle's real USDC on a fork of Monad Testnet (77 checks), including a payout deferred by Circle's own blacklist and retried by `sweep`. [Local report](../verification/settlement-check.json), [fork report](../verification/settlement-fork-check.json).

## 2. Funding that reports Monad's commit states

`lemma_fund_attempt` subscribes to Monad's `monadLogs` stream before relaying, then reports each commit state of the funding transaction as MCP progress: Relayed, Proposed, Voted, Finalized, Verified. It returns at Verified. A read-only probe on Monad Testnet measured Proposed to Verified in about 1.5 seconds. Without a stream the desk polls the finalized block instead. [Monad WebSockets](https://docs.monad.xyz/reference/websockets).

## 3. The loop

```text
quote ──► buyer's guard (deterministic, buyer side)
            published terms, deadline profile, payees, evaluator roster, pinned rulebook hash
            auditor: index fresh? quote's issuer and evaluator free of blocking findings?
            └─► adds the quote digest to the wallet's approved set
agent ──► buyer wallet signs the USDC authorization only if its nonce (the quote digest) is approved
LemmaX relays fund() ──► Proposed, Voted, Finalized, Verified
evaluator settles ──► credit pays out automatically
auditor ──► decodes terms, rebuilds allocations, records verdicts per party
            └─► the next quote naming a flagged party is refused before anything is signed
```

### Rulebook and verdicts

[`rulebook/lemmax-rulebook-v1.json`](../rulebook/lemmax-rulebook-v1.json) publishes the tariff, deadline profiles, payout minimum, payees, the evaluator roster with the operator of every key, and the verdict policy. Its keccak hash is cited by every verdict and pinned in the buyer's guard. The shared rules in [`indexer/src/shared/conformance.mjs`](../indexer/src/shared/conformance.mjs) check what the contract cannot know:

| Verdict | Severity | Party |
|---|---|---|
| `above_tariff` | blocking | the quote's evaluator |
| `unregistered_or_self_evaluator` | blocking | the issuer |
| `off_terms`, `off_profile`, `operator_income` | recorded | the issuer |
| `below_tariff`, `opaque_call` | informational | the evaluator, or none |

A verdict is a rule-conformance finding, not a judgement of resource quality. Party records are kept per rulebook version, and a new version is the remediation path.

### Envio: the public auditor

The HyperIndex indexer in [`indexer/`](../indexer) reads Monad Testnet only. It recovers each attempt's public terms (from `AttemptTerms`, or from fund calldata for the three version 2 attempts), rebuilds who was paid what, records verdicts and party records, tracks payouts and deferrals, and validates LemmaX-format ERC-8004 feedback. Its records decide payments: the guard refuses to approve a quote when the index lags the chain by more than about 30 blocks or the quote names a party with a blocking verdict, and `LEMMAX_AUDIT_REQUIRED=false` is the documented override. With `LEMMAX_AUDITOR_URL` set, `lemma_verify_attempt` answers any attempt in one plain summary. A local auditor applies the same rules to RPC logs, for the fork rehearsal and as a second source on testnet. [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview).

### Privy: the buyer's mandate

The buyer's wallet is a Privy server wallet. Three P-256 authorization keys sit on the buyer's side and derive from the buyer's existing key: the principal owns the wallet and its policy, the agent signs under the policy, and the guard owns the approved-digest set. The policy is one ALLOW rule: sign only a USDC `ReceiveWithAuthorization` on chain 10143, paying the settlement contract at most the funding total, with a nonce in the guard's set. Because LemmaX's EIP-3009 nonce is the EIP-712 digest of the whole quote, one set-membership check makes Privy's TEE enforce every quote term it cannot read itself. Transfers, messages, raw hashes, transactions, export and 7702 have no rule and are denied by default. A prompt-injected agent, or a compromised LemmaX desk, cannot get a tampered quote paid. Before real funds move, `npm run privy:kill-test` checks every allow and deny path on a throwaway wallet. [Privy policies](https://docs.privy.io/controls/policies/overview), [condition sets](https://docs.privy.io/controls/policies/condition-sets).

Limits stated plainly: enforcement happens in Privy's TEE but cannot yet be attested by third parties; the auditor is independent of LemmaX only if the buyer pins the rulebook hash (the guard does) or runs its own copy of the indexer; demonstration evaluators are operated by LemmaX, as the rulebook declares.

## 4. Identity and reputation (ERC-8004)

Four agents are registered in the ERC-8004 Identity Registry on Monad Testnet: LemmaX Directory, LemmaX Evaluator, LemmaX Evaluator-b (the labelled fault-injection evaluator) and LemmaX Retrieval Provider. Each registration file is stored onchain as a data URI and names the settlement contract, the hash-pinned rulebook, the public auditor and the disclosure policy; the registry metadata repeats the role, settlement and rulebook hash. [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004).

Feedback follows the [architecture's disclosure rules](LemmaX-Architecture.md#4-settlement-and-erc-8004-reputation): nothing is published automatically per attempt. An operator command, `npm run reputation` (preview by default, `--publish` to send), posts batched records:

- **Acceptance.** The evaluator reports to the Provider agent how many of the settled public-benchmark attempts it attested were accepted. Descriptive, not a probability; timeouts excluded.
- **Conformance.** The quote issuer reports to each evaluator agent how many of its settled attempts followed the rulebook. The demonstration's overcharge becomes a portable record on Evaluator-b's identity.

Feedback files carry only attempt IDs and settlement transactions, never offer, case, company or resource tags, so they restate what settlement already made public. The auditor accepts a record only from a rostered client, with a matching file hash, settled attempts counted once and a value that matches the indexed outcomes.

## 5. Running it

`npm run demo:loop` runs the loop in a few plain lines: an honest success, an eligible failure, the labelled evaluator's overcharge, the refused quote that names it, and a timeout refund, followed by the automatic payouts, the audit and the reconciliation. `LEMMAX_DEMO_TARGET=fork` rehearses on a local fork of Monad Testnet with the local mandate and audit; [rehearsal report](../verification/trust-loop-fork.json). `LEMMAX_DEMO_TARGET=testnet` is a dry run unless `LEMMAX_DEMO_BROADCAST=1`.
