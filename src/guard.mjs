import { getAddress } from "viem";
import { normalizeQuote, quoteDigest, verifyQuote } from "./attempt.mjs";
import { RULEBOOK_HASH, RULEBOOK_INDEX, admission } from "./rulebook.mjs";

// The buyer's guard: a small, deterministic process on the buyer's side. It approves a
// quote only if the issuer really signed it, it pays this buyer under the published
// rulebook, the authorization the agent would sign matches it exactly, and the public
// auditor is fresh and has no blocking finding against the quote's issuer or evaluator.
// Approval adds the quote digest to the Privy condition set the mandate checks; nothing
// else can make the buyer's wallet sign. It fails closed unless auditing is switched off.
export function createBuyerGuard({ buyer, domain, approvedIssuer, chainTime, audit, conditionSets, setId,
  auditRequired = true, maxLagBlocks = 30, index = RULEBOOK_INDEX, pinnedRulebookHash = RULEBOOK_HASH }) {
  const wallet = getAddress(buyer);
  const refuse = reasons => ({ approved: false, reasons });
  return Object.freeze({
    async approve({ quote, issuerSignature, buyerAuthorization }) {
      if (index.hash !== pinnedRulebookHash) return refuse(["rulebook_changed"]);
      let q;
      try { q = normalizeQuote(quote); } catch { return refuse(["malformed_quote"]); }
      if (!await verifyQuote({ domain, quote: q, signature: issuerSignature, approvedIssuer: await approvedIssuer(), now: await chainTime() })) return refuse(["issuer_signature_or_expiry"]);
      if (q.buyer !== wallet) return refuse(["wrong_buyer"]);
      const digest = quoteDigest(domain, q), m = buyerAuthorization?.message ?? {};
      const total = (BigInt(q.principal) + BigInt(q.executionCap) + BigInt(q.evaluationCap)).toString();
      if (getAddress(m.from ?? "0x0000000000000000000000000000000000000000") !== wallet || getAddress(m.to ?? "0x0000000000000000000000000000000000000000") !== getAddress(domain.verifyingContract)
        || String(m.value) !== total || String(m.nonce).toLowerCase() !== digest.toLowerCase()) return refuse(["authorization_mismatch"]);
      let records = {}, lag;
      try { ({ records, freshness: { lagBlocks: lag } } = await audit.partyRecords([q.issuer, q.evaluatorSigner])); }
      catch { if (auditRequired) return refuse(["index_unavailable"]); }
      const decision = admission({ quote: q, index, records, indexLagBlocks: auditRequired ? lag : 0, maxLagBlocks });
      if (!decision.admit) return refuse(decision.reasons);
      const [item] = await conditionSets.add(setId, [digest]);
      return { approved: true, digest, itemId: item?.id ?? null, reasons: [] };
    },
    // Digests live only for one funding window: remove them once funded or expired.
    async release(approval) { if (approval?.itemId) await conditionSets.remove(setId, approval.itemId); },
  });
}
