# The LemmaX trust loop on Monad

The trust loop connects signed purchase terms, a buyer-controlled spending guard, settlement and public rule checks. The buyer authorizes USDC funding, while a relayer pays MON gas. Contract version 3 is deployed on Monad Testnet, and the full loop has been rehearsed on a fork with a local wallet policy and auditor ([rehearsal report](../verification/trust-loop-fork.json)). On testnet it has run 19 attempts, and for the page's last ten the buyer's guard read the hosted Envio auditor before the wallet signed ([runs](../verification/live-runs-testnet.json), [auditor check](../verification/auditor-check-testnet.json)). The full loop also ran on testnet: evaluator-b's overcharge became a blocking Envio finding, and the guard refused the next quote naming it ([testnet report](../verification/trust-loop-testnet.json)). The Privy policy passed its kill test, LemmaX's four ERC-8004 agents are registered with published feedback, and the buyer's own Privy wallet is pending.

## 1. The Monad problem: stranded agent funds

LemmaX relays the buyer's EIP-3009 authorization, so the buyer needs USDC to fund an attempt and no MON. In contract version 2, collecting a refund or earned credit required the owner to send a withdrawal transaction and pay MON gas. A wallet holding only USDC could receive credit yet be unable to collect it itself.

Monad charges the transaction's gas limit rather than its gas used. Its reserve-balance rules also constrain native MON spending, with exceptions for certain undelegated accounts. They do not require every USDC owner to keep 10 MON. The buyer sends no native value in the relayed funding path. [Monad gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing), [reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance).

**Contract version 3 pays credit out automatically.** When a settlement or refund brings an owner's credit to its bar (at least 0.01 USDC), the contract attempts to transfer the whole credit in the same transaction, which the relayer pays for. A refused token transfer, such as a blocked payee or paused token, restores the credit and emits `PayoutDeferred`; anyone can retry with `sweep`. An owner may route payouts elsewhere or raise its bar with one signed `PayoutInstruction` that anyone can relay (EOA or ERC-1271 signatures). Credit below the bar remains owed to its owner; `withdraw` remains available for owners who hold MON. Funding also publishes the quote's public terms in `AttemptTerms`, and the contract refuses an issuer that names itself evaluator. [Contract](../contracts/AttemptSettlement.sol).

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
evaluator settles ──► credit pays out when it reaches the owner's bar
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

The HyperIndex indexer in [`indexer/`](../indexer) is configured for Monad Testnet. It recovers each attempt's public terms (from `AttemptTerms`, or from fund calldata for the three version 2 attempts), rebuilds who was paid what, records verdicts and party records, tracks payouts and deferrals, and validates LemmaX-format ERC-8004 feedback. Its hosted deployment on Envio Cloud serves a public GraphQL endpoint, `https://indexer.dev.hyperindex.xyz/7c5b0aa/v1/graphql`. `npm run auditor:check` compares it with the local auditor, which applies the same shared rules to RPC logs: they agree on all four contract version 3 attempts, the three version 2 attempts match the outcomes recorded when they ran, and the buyer's guard approves a fresh bill while reading it, with the index a few blocks behind the chain head. Nothing is broadcast by the check. [Check](../verification/auditor-check-testnet.json), [rehearsal report](../verification/trust-loop-fork.json), [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview).

When an auditor is configured, its records gate the next purchase: the buyer's guard refuses a quote if the index is more than 30 blocks behind or the quote names a party with a blocking verdict. The guard also requires the index to have processed a settlement the buyer already knows about. `LEMMAX_AUDIT_REQUIRED=false` is the documented override. The guard also fails closed when the index cannot be reached. The live page and the wallet server read the public Envio index by default for contract version 3; `LEMMAX_AUDITOR_URL` points them elsewhere, and `LEMMAX_AUDITOR_URL=local` applies the same rules to Monad logs. With an auditor set, `lemma_verify_attempt` summarizes the indexed public attempt record.

### Privy: the buyer's mandate

The Privy integration creates a server wallet with a restricted signing policy. Its kill test passed all 13 checks on a throwaway Privy wallet ([report](../verification/privy-kill-test.json)): the one approved digest was signed in 222 ms, and every other request was refused, including that digest once the guard removed it. One of those refusals, raw hash signing, came back as an invalid request rather than a policy refusal. `npm run privy:setup` creates the buyer's own Privy wallet; until it exists, the page and the fork rehearsal use a local implementation of the same policy, and a server whose agent or guard key differs from the wallet record falls back to it and says why. Three P-256 authorization keys sit on the buyer's side: the principal owns the wallet and its policy, the agent signs under the policy, and the guard owns the approved-digest set. The agent key derives from the buyer's existing key. `LEMMAX_PRINCIPAL_SECRET` and `LEMMAX_GUARD_SECRET` give the other two roles independent root secrets. Without them, those roles also derive from the buyer's key, and the report discloses that weaker separation. [Key configuration](../src/privy-buyer.mjs).

The configured policy is one ALLOW rule: sign only a USDC `ReceiveWithAuthorization` on chain 10143, paying the settlement contract at most the funding total, with a nonce in the guard's set. LemmaX uses the EIP-712 digest of the whole quote as that nonce, binding approval to the frozen terms. Transfers, messages, raw hashes, transactions, export and 7702 have no rule and are intended to be denied by default. `npm run privy:kill-test` exercises the allow and deny paths on a throwaway wallet before live use. [Privy policies](https://docs.privy.io/controls/policies/overview), [condition sets](https://docs.privy.io/controls/policies/condition-sets).

The intended signing enforcement depends on Privy's service and the buyer's key custody; the local rehearsal does not attest its TEE or prove live policy enforcement. Pinning the rulebook hash prevents a changed rulebook from being accepted, but does not prove an auditor's completeness or independence. A buyer can run its own auditor. LemmaX operates both evaluators today, as the rulebook declares, and their signatures do not prove honest result evaluation.

## 4. Identity and reputation (ERC-8004)

LemmaX's four agents are registered in the ERC-8004 Identity Registry on Monad Testnet as agents 2296 to 2299, each owned by its role key ([deployment](../deployments/erc8004-agents.json), [registration files](../registrations/)): LemmaX Directory, LemmaX Evaluator, LemmaX Evaluator-b (a canary checker LemmaX runs, which overcharges on purpose so anyone can check the auditor's finding and the wallet's refusal) and LemmaX Retrieval Provider. Each registration file is written onchain as a data URI and names the settlement contract, the hash-pinned rulebook, the public auditor and the disclosure policy; the registry metadata repeats the role, settlement and rulebook hash. [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004).

Feedback follows the [architecture's disclosure rules](LemmaX-Architecture.md#4-settlement-and-erc-8004-reputation): nothing is published automatically per attempt. An operator command, `npm run reputation` (preview by default, `--publish` to send), posts batched records. Two batches cover all 19 settled contract version 3 attempts so far, and Envio marks all five records valid ([record](../verification/reputation-testnet.json)); the second carries Evaluator-b's overcharge from the testnet trust loop as 0 of 1 conforming:

- **Acceptance.** The evaluator reports to the Provider agent how many of the settled public-benchmark attempts it attested were accepted. Descriptive, not a probability; timeouts excluded.
- **Conformance.** The quote issuer reports to each evaluator agent how many of its settled attempts followed the rulebook. The canary's overcharge becomes a portable record on Evaluator-b's identity.

Feedback files carry only attempt IDs and settlement transactions, never offer, case, company or resource tags, so they restate what settlement already made public. The auditor accepts a record only from a rostered client, with a matching file hash, settled attempts counted once and a value that matches the indexed outcomes.

## 5. Running it

`npm run demo:loop` runs the loop in a few plain lines: an honest success, an eligible failure, the canary's overcharge, the refused quote that names it, and a timeout refund, followed by the automatic payouts, the audit and the reconciliation. `LEMMAX_DEMO_TARGET=fork` rehearses on a local fork of Monad Testnet with the local mandate and audit; [rehearsal report](../verification/trust-loop-fork.json). `LEMMAX_DEMO_TARGET=testnet` is a dry run unless `LEMMAX_DEMO_BROADCAST=1`; the recorded testnet run used the deployed contract version 3 and the hosted Envio auditor ([testnet report](../verification/trust-loop-testnet.json)).
