import { describe, it } from "vitest";
import { createTestIndexer } from "envio";
import { encodeFunctionData } from "viem";
import SETTLEMENT_ABI from "../abis/AttemptSettlement.json" with { type: "json" };
import RULEBOOK from "../src/shared/lemmax-rulebook-v1.json" with { type: "json" };
import { rulebookHash } from "../src/shared/conformance.mjs";
import { FEEDBACK_SCHEMA, FEEDBACK_TAGS, encodeFeedbackFile } from "../src/shared/feedback.mjs";

// Simulated events only: no network, no token. The v2 address decodes terms from fund
// calldata; any other address is treated as v3 and takes terms from AttemptTerms.
const V2 = "0xfb59487E973C883E3fe4301238D485f7B248fA7f" as const;
const V3 = "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7" as const;
const HASH = rulebookHash(RULEBOOK);
const roles = RULEBOOK.roles;
const [main, evaluatorB] = roles.evaluators as unknown as [{ signer: string; payee: string }, { signer: string; payee: string }];
const A = (value: string) => value as `0x${string}`;
const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const tx = (n: number) => `0x${(1000 + n).toString(16).padStart(64, "0")}` as const;
const quote = (n: number, changes: Record<string, unknown> = {}) => ({
  attemptId: id(n), recordCommitment: id(100 + n), policyHash: id(200), issuer: roles.issuer.address, buyer: "0x2B62DaD005E9342A11C651C236bbdE7AfBa64681",
  connectorPayee: roles.connectors[0]!.address, executorPayee: roles.executor.address, evaluatorPayee: main.payee, evaluatorSigner: main.signer,
  asset: RULEBOOK.asset, principal: 5000n, executionCap: 2000n, evaluationCap: 1000n, quoteExpiresAt: 1120n, executeBy: 1240n, settleBy: 1600n, timeoutMode: 1, ...changes });
const tuple = (q: ReturnType<typeof quote>) => [q.attemptId, q.recordCommitment, q.policyHash, q.issuer, q.buyer, q.connectorPayee, q.executorPayee,
  q.evaluatorPayee, q.evaluatorSigner, q.asset, q.principal, q.executionCap, q.evaluationCap, q.quoteExpiresAt, q.executeBy, q.settleBy, BigInt(q.timeoutMode)] as const;
const committed = (n: number, srcAddress: `0x${string}`, input?: `0x${string}`) => ({ contract: "AttemptSettlement" as const, event: "AttemptCommitted" as const, srcAddress,
  transaction: { hash: tx(n), to: srcAddress, input: input ?? "0x" }, params: { attemptId: id(n), recordCommitment: id(100 + n), quoteDigest: id(300 + n) } });
const terms = (n: number, q: ReturnType<typeof quote>) => ({ contract: "AttemptSettlement" as const, event: "AttemptTerms" as const, srcAddress: V3,
  transaction: { hash: tx(n) }, params: { attemptId: id(n), buyer: A(q.buyer), evaluatorSigner: A(q.evaluatorSigner), quote: tuple(q) as never } });
const outcome = (n: number, srcAddress: `0x${string}`, state: number, executionUsed: bigint, evaluationUsed: bigint) => ({ contract: "AttemptSettlement" as const,
  event: "AttemptOutcome" as const, srcAddress, transaction: { hash: tx(50 + n) }, params: { attemptId: id(n), state: BigInt(state), evidenceCommitment: id(400 + n), executionUsed, evaluationUsed } });
const fundInput = (q: ReturnType<typeof quote>) => (encodeFunctionData as (x: unknown) => `0x${string}`)({ abi: SETTLEMENT_ABI, functionName: "fund",
  args: [q, "0x", { validAfter: 0n, validBefore: 1n, signature: "0x" }] });
const feedback = (n: number, client: string, kind: "acceptance" | "conformance", attemptIds: string[], value: bigint) => {
  const file = encodeFeedbackFile({ schemaVersion: FEEDBACK_SCHEMA, kind, rulebookHash: HASH, attempts: attemptIds.map(attemptId => ({ attemptId })) });
  return { contract: "ReputationRegistry" as const, event: "NewFeedback" as const, transaction: { hash: tx(80 + n) }, params: { agentId: 7n, clientAddress: A(client),
    feedbackIndex: BigInt(n), value, valueDecimals: 2n, indexedTag1: FEEDBACK_TAGS[kind], tag1: FEEDBACK_TAGS[kind], tag2: "lemmax-rulebook/v1", endpoint: "",
    feedbackURI: file.uri, feedbackHash: file.hash } };
};

describe("LemmaX settlement auditor", () => {
  it("decodes terms, rebuilds allocations, attributes verdicts and validates feedback", async t => {
    const indexer = createTestIndexer();
    const honestV2 = quote(1), overcharged = quote(2, { evaluatorSigner: evaluatorB.signer, evaluatorPayee: evaluatorB.payee }), selfEvaluated = quote(3, { evaluatorSigner: roles.issuer.address });
    await indexer.process({ chains: { 10143: { simulate: [
      committed(1, V2, fundInput(honestV2)), outcome(1, V2, 2, 1500n, 800n),
      committed(2, V3), terms(2, overcharged), outcome(2, V3, 2, 1500n, 1000n),
      committed(3, V3), terms(3, selfEvaluated),
      { contract: "AttemptSettlement", event: "CreditPaid", srcAddress: V3, transaction: { hash: tx(60) }, params: { owner: A(roles.connectors[0]!.address), destination: A(roles.connectors[0]!.address), amount: 10000n } },
      { contract: "AttemptSettlement", event: "PayoutDeferred", srcAddress: V3, transaction: { hash: tx(61) }, params: { owner: A(evaluatorB.payee), destination: A(evaluatorB.payee), amount: 12000n } },
      feedback(1, main.signer, "acceptance", [id(1)], 10000n),
      feedback(2, main.signer, "acceptance", [id(1)], 10000n),
      feedback(3, "0x1000000000000000000000000000000000000001", "acceptance", [id(1)], 10000n),
      feedback(4, roles.issuer.address, "conformance", [id(2)], 0n),
      feedback(5, roles.issuer.address, "conformance", [id(1)], 0n),
    ] } } });

    const first = await indexer.Attempt.getOrThrow(id(1));
    t.expect([first.termsSource, first.state, first.allocation, first.verdictCodes, first.blocking]).toEqual(
      ["calldata", "settled_success", { connector: "5000", executor: "1500", evaluator: "800", buyer: "700", total: "8000" }, [], false]);
    const second = await indexer.Attempt.getOrThrow(id(2));
    t.expect([second.termsSource, second.verdictCodes, second.blocking]).toEqual(["event", ["above_tariff"], true]);
    const flagged = await indexer.PartyRecord.getOrThrow(`${evaluatorB.signer.toLowerCase()}_${HASH}`);
    t.expect([flagged.attempts, flagged.blocking, flagged.lastVerdict]).toEqual([1, 1, "above_tariff"]);
    const clean = await indexer.PartyRecord.getOrThrow(`${main.signer.toLowerCase()}_${HASH}`);
    t.expect([clean.attempts, clean.blocking]).toEqual([1, 0]);
    const issuer = await indexer.PartyRecord.getOrThrow(`${roles.issuer.address.toLowerCase()}_${HASH}`);
    t.expect([issuer.attempts, issuer.blocking, issuer.lastVerdict]).toEqual([3, 1, "unregistered_or_self_evaluator"]);
    t.expect((await indexer.Payout.getAll()).map(p => [p.kind, p.amount])).toEqual([["paid", 10000n], ["deferred", 12000n]]);

    const reputation = Object.fromEntries((await indexer.ReputationRecord.getAll()).map(r => [String(r.feedbackIndex), [r.valid, r.reason ?? null]]));
    t.expect(reputation).toEqual({ "1": [true, null], "2": [false, "attempt_counted_twice"], "3": [false, "unrostered_client"],
      "4": [true, null], "5": [false, "value_mismatch"] });
  });
});
