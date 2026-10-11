import { bytes32 } from "./attempt.mjs";

// MCP results must be plain JSON; typed data and receipts carry bigints.
export const plain = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
// A funding transaction mined after quoteExpiresAt reverts and still pays its whole gas
// limit on Monad. Whole-second timestamps on 300 ms blocks need this much slack.
export const FUNDING_MARGIN_SECONDS = 5n;

// Progress steps a funding call reports: the relay, then Monad's commit states.
export const FUNDING_STEPS = Object.freeze(["Relayed", "Proposed", "Voted", "Finalized", "Verified"]);

// Operator-side purchase path for public benchmark attempts. Quotes are issued and held
// here; funding relays only a quote this desk issued, using the buyer's EIP-3009
// authorization, then follows the transaction to Verified. With `stages` (a monadLogs
// watcher factory) each commit state is reported as it happens; without it, or if the
// subscription fails, `confirm` polls instead. State is in memory.
export function createPurchaseDesk({ issuer, settlement, relayer, data, chainTime, confirm, stages = null, stageTimeoutMs = 60000 }) {
  const quotes = new Map(), funding = new Set();
  return Object.freeze({
    async quote({ offerRef, caseRef, profileRef, buyer }) {
      if (!data.gold.has(caseRef)) throw new TypeError("Unknown public benchmark case");
      const issued = await issuer.issue({ offerRef, caseRef, query: data.queries.get(caseRef), buyer, profileRef, issuedAt: await chainTime() });
      quotes.set(issued.quote.attemptId, issued);
      return plain({ attemptId: issued.quote.attemptId, profileRef, currency: "USDC", decimals: 6, fundingTotal: issuer.fundingTotal,
        quote: issued.quote, issuerSignature: issued.issuerSignature, quoteDigest: issued.quoteDigest,
        buyerAuthorization: issued.authorization, privateRecord: { record: issued.record, salt: issued.salt },
        note: "Sign buyerAuthorization with the buyer wallet and pass the signature to lemma_fund_attempt. Keep privateRecord private." });
    },
    async fund({ attemptId, validAfter, validBefore, signature }, { onProgress = () => {} } = {}) {
      const id = bytes32(attemptId), issued = quotes.get(id);
      if (!issued) throw new TypeError("Unknown quote");
      // Only the issued window is relayed. A buyer-chosen short window could expire between
      // estimate and inclusion, and a mined revert still pays its whole gas limit on Monad.
      const window = issued.authorization.message;
      if (String(validAfter) !== window.validAfter || String(validBefore) !== window.validBefore) throw new TypeError("Authorization window differs from the issued quote");
      // One relay per quote at a time; the relayer's gas is spent only on fundable quotes.
      if (funding.has(id)) throw new TypeError("Funding already in progress for this quote");
      funding.add(id);
      try {
        if (BigInt(await chainTime()) + FUNDING_MARGIN_SECONDS > BigInt(issued.quote.quoteExpiresAt)) throw new RangeError("Quote expires too soon to relay safely");
        if ((await settlement.attemptInfo(id)).state !== "none") throw new TypeError("Attempt is already funded or closed");
        // Subscribe before sending, so the first commit state cannot be missed.
        const watcher = stages ? await stages().catch(() => null) : null;
        const started = Date.now(), timeline = [];
        const report = (step, extra = {}) => {
          if (timeline.some(t => t.step === step)) return;
          timeline.push({ step, ms: Date.now() - started, ...extra });
          onProgress({ progress: FUNDING_STEPS.indexOf(step) + 1, total: FUNDING_STEPS.length, message: step });
        };
        try {
          const result = await settlement.fund({ wallet: relayer, quote: issued.quote, issuerSignature: issued.issuerSignature,
            authorization: { validAfter, validBefore, signature } });
          report("Relayed", { transactionHash: result.hash });
          let confirmation = "verified";
          try {
            if (!watcher) throw new Error("no stream");
            await watcher.until(result.hash, { onStage: s => report(s.stage, { blockNumber: s.blockNumber }), timeoutMs: stageTimeoutMs });
          } catch {
            // Polling fallback: the finalized tag, then three more blocks for Verified.
            confirmation = (await confirm(result)).stage;
            report("Finalized"); report("Verified");
          }
          return plain({ attemptId: issued.quote.attemptId, state: "funded", transactionHash: result.hash, blockNumber: result.blockNumber,
            confirmation, timeline, gasUsed: result.gasUsed, gasLimit: result.gasLimit });
        } finally { watcher?.close(); }
      } finally { funding.delete(id); }
    },
    async status({ attemptId }) {
      return plain({ attemptId: bytes32(attemptId), ...await settlement.attemptInfo(attemptId) });
    },
    issued(attemptId) { return quotes.get(bytes32(attemptId)) ?? null; },
  });
}
