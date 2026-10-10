import { bytes32 } from "./attempt.mjs";

// MCP results must be plain JSON; typed data and receipts carry bigints.
export const plain = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));

// Operator-side purchase path for public benchmark attempts. Quotes are issued and held
// here; funding relays only a quote this desk issued, using the buyer's EIP-3009
// authorization, then waits for the configured confirmation stage. State is in memory.
export function createPurchaseDesk({ issuer, settlement, relayer, data, chainTime, confirm }) {
  const quotes = new Map();
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
    async fund({ attemptId, validAfter, validBefore, signature }) {
      const issued = quotes.get(bytes32(attemptId));
      if (!issued) throw new TypeError("Unknown quote");
      const result = await settlement.fund({ wallet: relayer, quote: issued.quote, issuerSignature: issued.issuerSignature,
        authorization: { validAfter, validBefore, signature } });
      const confirmation = await confirm(result);
      return plain({ attemptId: issued.quote.attemptId, state: "funded", transactionHash: result.hash, blockNumber: result.blockNumber,
        confirmation: confirmation.stage, gasUsed: result.gasUsed, gasLimit: result.gasLimit });
    },
    async status({ attemptId }) {
      return plain({ attemptId: bytes32(attemptId), ...await settlement.attemptInfo(attemptId) });
    },
    issued(attemptId) { return quotes.get(bytes32(attemptId)) ?? null; },
  });
}
