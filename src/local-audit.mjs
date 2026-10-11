import { readSettlementLogs } from "./reconcile.mjs";
import { attemptsFromLogs } from "./reputation.mjs";
import { RULEBOOK_HASH, RULEBOOK_INDEX, outcomeVerdicts, quoteVerdicts } from "./rulebook.mjs";

// The same audit, computed from chain logs with the same shared rules as the Envio indexer.
// It serves the fork rehearsal (no hosted index there) and gives a second, independent
// source to compare with Envio on testnet. Freshness is the log read itself: lag 0.
export function createLocalAudit({ publicClient, address, fromBlock, maxBlockRange = 100n }) {
  async function snapshot() {
    const head = await publicClient.getBlockNumber();
    const logs = await readSettlementLogs({ publicClient, address, fromBlock, toBlock: head, maxBlockRange });
    const termsById = new Map(logs.filter(l => l.eventName === "AttemptTerms").map(l => [l.attemptId, l.quote]));
    const records = {};
    const bump = (party, field) => {
      const key = String(party).toLowerCase();
      records[key] ??= { party: key, rulebookHash: RULEBOOK_HASH, attempts: 0, blocking: 0, recorded: 0, informational: 0, lastVerdict: null };
      records[key][field] += 1;
      return records[key];
    };
    for (const quote of termsById.values()) for (const party of new Set([quote.issuer.toLowerCase(), quote.evaluatorSigner.toLowerCase()])) bump(party, "attempts");
    const verdicts = [];
    for (const log of logs) {
      const quote = termsById.get(log.attemptId);
      if (!quote) continue;
      const found = log.eventName === "AttemptTerms" ? quoteVerdicts(quote, RULEBOOK_INDEX) : log.eventName === "AttemptOutcome" ? outcomeVerdicts(quote, log, RULEBOOK_INDEX) : [];
      for (const v of found) { bump(v.party, v.severity).lastVerdict = v.code; verdicts.push({ attemptId: log.attemptId, ...v, txHash: log.transactionHash }); }
    }
    return { head, logs, records, verdicts };
  }
  return Object.freeze({
    async freshness() { const head = await publicClient.getBlockNumber(); return { progressBlock: head.toString(), head: head.toString(), lagBlocks: 0 }; },
    async partyRecords(parties) {
      const { head, records } = await snapshot();
      const wanted = new Set(parties.map(p => String(p).toLowerCase()));
      return { records: Object.fromEntries(Object.entries(records).filter(([party]) => wanted.has(party))), freshness: { progressBlock: head.toString(), head: head.toString(), lagBlocks: 0 } };
    },
    async attempt(attemptId) {
      const { head, logs, verdicts } = await snapshot();
      const found = attemptsFromLogs(logs).find(a => a.attemptId === attemptId) ?? null;
      return { attempt: found && { id: found.attemptId, state: found.state, termsSource: "event", fundTx: null, outcomeTx: found.settleTx, allocation: null },
        verdicts: verdicts.filter(v => v.attemptId === attemptId), freshness: { progressBlock: head.toString(), head: head.toString(), lagBlocks: 0 } };
    },
    snapshot,
  });
}
