import { bytes32 } from "./attempt.mjs";
import { RULEBOOK_HASH } from "./rulebook.mjs";

// Reads the Envio auditor's GraphQL API: index freshness, attempt verdicts and party
// records. Freshness compares the indexer's processed block with the chain head from
// the caller's own RPC, so a stalled index cannot report itself as current.
const ATTEMPT_FIELDS = "id settlement state buyer issuer evaluatorSigner connectorPayee executorPayee evaluatorPayee principal executionCap evaluationCap termsSource fundTx outcomeTx executionUsed evaluationUsed allocation verdictCodes blocking";

export function createAuditClient({ url, publicClient, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
  if (typeof url !== "string" || !/^https?:\/\/\S+$/.test(url)) throw new TypeError("Provide the auditor's GraphQL URL");
  async function query(text, variables = {}) {
    const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text, variables }), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Auditor returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.errors?.length) throw new Error("Auditor query failed");
    return body.data;
  }
  async function freshness(meta) {
    const rows = Array.isArray(meta) ? meta : meta ? [meta] : [];
    const row = rows.find(m => Number(m.chainId) === publicClient.chain?.id) ?? rows[0];
    if (!row || row.progressBlock === undefined || row.progressBlock === null) return { progressBlock: null, head: null, lagBlocks: null };
    const head = await publicClient.getBlockNumber();
    const progressBlock = BigInt(row.progressBlock);
    return { progressBlock: progressBlock.toString(), head: head.toString(), lagBlocks: Number(head > progressBlock ? head - progressBlock : 0n) };
  }
  return Object.freeze({
    url,
    async freshness() { return freshness((await query("{ _meta { chainId progressBlock isReady } }"))._meta); },
    // Records for the given parties under the current rulebook, keyed by lowercase address.
    async partyRecords(parties) {
      const lowered = [...new Set(parties.map(p => String(p).toLowerCase()))];
      const data = await query(`query($parties: [String!]!, $hash: String!) {
        _meta { chainId progressBlock isReady }
        PartyRecord(where: { party: { _in: $parties }, rulebookHash: { _eq: $hash } }) { party rulebookHash attempts blocking recorded informational lastVerdict lastVerdictTx }
      }`, { parties: lowered, hash: RULEBOOK_HASH });
      return { records: Object.fromEntries(data.PartyRecord.map(r => [r.party, r])), freshness: await freshness(data._meta) };
    },
    async attempt(attemptId) {
      const id = bytes32(attemptId);
      const data = await query(`query($id: String!) {
        _meta { chainId progressBlock isReady }
        Attempt(where: { id: { _eq: $id } }) { ${ATTEMPT_FIELDS} }
        Verdict(where: { attemptId: { _eq: $id } }) { code severity party role detail rulebookHash txHash }
      }`, { id });
      return { attempt: data.Attempt[0] ?? null, verdicts: data.Verdict, freshness: await freshness(data._meta) };
    },
  });
}

// One plain answer for an agent: what happened to the attempt, who was paid what, and
// whether the published rules were followed.
export async function verifyAttempt(audit, attemptId) {
  const { attempt, verdicts, freshness } = await audit.attempt(attemptId);
  if (!attempt) return { attemptId: bytes32(attemptId), found: false, indexLagBlocks: freshness.lagBlocks, summary: "Not indexed yet." };
  const flagged = verdicts.filter(v => v.severity !== "informational");
  const summary = [attempt.state.replace("_", " "), attempt.allocation ? "allocation rebuilt from public terms" : "allocation pending",
    flagged.length ? `${flagged.length} rule finding(s): ${flagged.map(v => v.code).join(", ")}` : "follows the published rules"].join("; ");
  return { attemptId: attempt.id, found: true, state: attempt.state, termsSource: attempt.termsSource, allocation: attempt.allocation ?? null,
    verdicts, rulebookHash: RULEBOOK_HASH, indexLagBlocks: freshness.lagBlocks, fundTx: attempt.fundTx, outcomeTx: attempt.outcomeTx ?? null, summary };
}
