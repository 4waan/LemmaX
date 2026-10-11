import { S, createEffect, indexer, type EvmOnEventContext } from "envio";
import { createPublicClient, decodeFunctionData, http } from "viem";
import SETTLEMENT_ABI from "../../abis/AttemptSettlement.json" with { type: "json" };
import { outcomeVerdicts, publicAllocation, quoteVerdicts } from "../shared/conformance.mjs";
import { INDEX } from "../shared/rules.mjs";

// The auditor reads only public chain data. For each attempt it recovers the funded
// quote's public terms, rebuilds who is owed what, and records verdicts under the
// hash-pinned rulebook. Verdicts feed the buyer's guard; nothing here sends transactions.
const STATES = ["none", "funded", "settled_success", "settled_failure", "refunded_timeout"] as const;
const QUOTE_FIELDS = ["attemptId", "recordCommitment", "policyHash", "issuer", "buyer", "connectorPayee", "executorPayee", "evaluatorPayee",
  "evaluatorSigner", "asset", "principal", "executionCap", "evaluationCap", "quoteExpiresAt", "executeBy", "settleBy", "timeoutMode"] as const;
// Contract v2 has no AttemptTerms event; its three historic attempts are decoded from fund calldata.
const LEGACY_V2 = new Set(["0xfb59487e973c883e3fe4301238d485f7b248fa7f"]);
const ZERO = "0x0000000000000000000000000000000000000000";

type Quote = Record<(typeof QUOTE_FIELDS)[number], string>;
const lower = (value: unknown) => String(value).toLowerCase();
function quoteFrom(values: readonly unknown[] | Record<string, unknown>): Quote {
  // Tuples arrive positionally (an array, or an object keyed 0..16); decoded calldata by name.
  const positional = Array.isArray(values) || Object.hasOwn(values, "0");
  const get = (key: string, i: number) => (positional ? (values as Record<number, unknown>)[i] : (values as Record<string, unknown>)[key]);
  return Object.fromEntries(QUOTE_FIELDS.map((key, i) => {
    const v = get(key, i);
    return [key, typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : String(v)];
  })) as Quote;
}

// Fallback when the data source omits transaction input: read it once over public RPC.
const transactionInput = createEffect(
  { name: "transactionInput", input: S.string, output: S.union([S.string, null]), cache: true, rateLimit: false, crossChain: false },
  async ({ input: hash }) => {
    const client = createPublicClient({ transport: http(process.env.ENVIO_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz", { batch: true }) });
    const tx = await client.getTransaction({ hash: hash as `0x${string}` });
    return tx?.input ?? null;
  },
);

function decodeFund(input: string | undefined | null, to: string | undefined | null, settlement: string): Quote | null {
  if (!input || lower(to) !== settlement) return null;
  try {
    const call = decodeFunctionData({ abi: SETTLEMENT_ABI as never, data: input as `0x${string}` });
    return call.functionName === "fund" ? quoteFrom((call.args as unknown[])[0] as Record<string, unknown>) : null;
  } catch { return null; }
}

type Ctx = EvmOnEventContext;

async function party(context: Ctx, address: string, change: { attempts?: number; verdict?: { code: string; severity: string; txHash: string } }) {
  const id = `${address}_${INDEX.hash}`;
  const current = (await context.PartyRecord.get(id)) ?? { id, party: address, rulebookHash: INDEX.hash, attempts: 0, blocking: 0, recorded: 0,
    informational: 0, lastVerdict: undefined, lastVerdictTx: undefined };
  const v = change.verdict;
  context.PartyRecord.set({ ...current, attempts: current.attempts + (change.attempts ?? 0),
    blocking: current.blocking + (v?.severity === "blocking" ? 1 : 0), recorded: current.recorded + (v?.severity === "recorded" ? 1 : 0),
    informational: current.informational + (v?.severity === "informational" ? 1 : 0),
    lastVerdict: v ? v.code : current.lastVerdict, lastVerdictTx: v ? v.txHash : current.lastVerdictTx });
}

type Verdict = { code: string; severity: string; party: string; role: string; detail: string; rulebookHash: string };
async function record(context: Ctx, attemptId: string, verdicts: Verdict[], txHash: string) {
  const attempt = await context.Attempt.get(attemptId);
  for (const v of verdicts) {
    const party_ = v.party || "unattributed";
    context.Verdict.set({ id: `${attemptId}_${v.code}_${party_}`, attemptId, code: v.code, severity: v.severity, party: party_, role: v.role,
      detail: v.detail, rulebookHash: v.rulebookHash, txHash });
    if (v.party) await party(context, v.party, { verdict: { code: v.code, severity: v.severity, txHash } });
  }
  if (attempt && verdicts.length) context.Attempt.set({ ...attempt, verdictCodes: [...attempt.verdictCodes, ...verdicts.map(v => v.code)],
    blocking: attempt.blocking || verdicts.some(v => v.severity === "blocking") });
}

function withTerms(base: Record<string, unknown>, q: Quote | null) {
  return { ...base, buyer: q?.buyer ?? ZERO, issuer: q?.issuer ?? ZERO, evaluatorSigner: q?.evaluatorSigner ?? ZERO,
    connectorPayee: q?.connectorPayee ?? ZERO, executorPayee: q?.executorPayee ?? ZERO, evaluatorPayee: q?.evaluatorPayee ?? ZERO,
    principal: BigInt(q?.principal ?? 0), executionCap: BigInt(q?.executionCap ?? 0), evaluationCap: BigInt(q?.evaluationCap ?? 0),
    quoteExpiresAt: BigInt(q?.quoteExpiresAt ?? 0), executeBy: BigInt(q?.executeBy ?? 0), settleBy: BigInt(q?.settleBy ?? 0) };
}
function termsOf(a: { buyer: string; issuer: string; evaluatorSigner: string; connectorPayee: string; executorPayee: string; evaluatorPayee: string;
  principal: bigint; executionCap: bigint; evaluationCap: bigint; quoteExpiresAt: bigint; executeBy: bigint; settleBy: bigint; settlement: string }): Quote {
  return quoteFrom({ ...a, asset: INDEX.asset, attemptId: "", recordCommitment: "", policyHash: "", timeoutMode: "1" } as Record<string, unknown>);
}

async function applyTerms(context: Ctx, attemptId: string, q: Quote, source: string, txHash: string) {
  const attempt = await context.Attempt.get(attemptId);
  if (!attempt) return;
  context.Attempt.set(withTerms({ ...attempt, termsSource: source }, q) as typeof attempt);
  // An attempt counts once per party, even when one address holds both roles.
  for (const address of new Set([q.issuer, q.evaluatorSigner])) await party(context, address, { attempts: 1 });
  await record(context, attemptId, quoteVerdicts(q, INDEX), txHash);
}

indexer.onEvent({ contract: "AttemptSettlement", event: "AttemptCommitted" }, async ({ event, context }) => {
  const settlement = lower(event.srcAddress), attemptId = event.params.attemptId, txHash = event.transaction.hash;
  context.Attempt.set(withTerms({ id: attemptId, settlement, quoteDigest: event.params.quoteDigest, recordCommitment: event.params.recordCommitment,
    termsSource: LEGACY_V2.has(settlement) ? "unavailable" : "pending", state: "funded", fundedBlock: event.block.number, fundTx: txHash,
    outcomeTx: undefined, executionUsed: undefined, evaluationUsed: undefined, allocation: undefined, verdictCodes: [], blocking: false }, null) as never);
  if (!LEGACY_V2.has(settlement)) return;
  const input = event.transaction.input && event.transaction.input !== "0x" ? event.transaction.input : await context.effect(transactionInput, txHash);
  const q = decodeFund(input, event.transaction.to, settlement);
  if (q) await applyTerms(context, attemptId, q, "calldata", txHash);
  else await record(context, attemptId, [{ code: "opaque_call", severity: INDEX.severity.opaque_call ?? "informational", party: "", role: "relay",
    detail: "funding did not call the settlement directly; terms not decoded", rulebookHash: INDEX.hash }], txHash);
});

indexer.onEvent({ contract: "AttemptSettlement", event: "AttemptTerms" }, async ({ event, context }) => {
  await applyTerms(context, event.params.attemptId, quoteFrom(event.params.quote as unknown as unknown[]), "event", event.transaction.hash);
});

indexer.onEvent({ contract: "AttemptSettlement", event: "AttemptOutcome" }, async ({ event, context }) => {
  const attempt = await context.Attempt.get(event.params.attemptId);
  if (!attempt) return;
  const state = STATES[Number(event.params.state)] ?? "none";
  const outcome = { state, executionUsed: event.params.executionUsed.toString(), evaluationUsed: event.params.evaluationUsed.toString() };
  const known = attempt.termsSource === "event" || attempt.termsSource === "calldata";
  const q = known ? termsOf(attempt) : null;
  context.Attempt.set({ ...attempt, state, outcomeTx: event.transaction.hash, executionUsed: event.params.executionUsed,
    evaluationUsed: event.params.evaluationUsed, allocation: q ? publicAllocation(q, outcome) : undefined });
  if (q) await record(context, attempt.id, outcomeVerdicts(q, outcome, INDEX), event.transaction.hash);
});

for (const [eventName, kind] of [["CreditPaid", "paid"], ["PayoutDeferred", "deferred"], ["CreditWithdrawn", "withdrawn"]] as const) {
  indexer.onEvent({ contract: "AttemptSettlement", event: eventName }, async ({ event, context }) => {
    context.Payout.set({ id: `${event.block.number}_${event.logIndex}`, owner: lower(event.params.owner), destination: lower(event.params.destination),
      amount: event.params.amount, kind, txHash: event.transaction.hash, blockNumber: event.block.number });
  });
}

indexer.onEvent({ contract: "AttemptSettlement", event: "PayoutInstructionSet" }, async ({ event, context }) => {
  const owner = lower(event.params.owner);
  context.PayoutInstruction.set({ id: `${owner}_${event.params.nonce}`, owner, destination: lower(event.params.destination),
    bar: event.params.bar, nonce: event.params.nonce, txHash: event.transaction.hash });
});
