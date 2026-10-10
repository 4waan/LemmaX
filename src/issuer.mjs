import { getAddress } from "viem";
import { ATTEMPT_SCHEMA, SETTLEMENT_POLICY_HASH, TIMEOUT_MODES, bindRecordToQuote, commitAttemptRecord, fundingAuthorizationTypedData,
  hashReference, newAttemptId, quoteDigest, quoteTypedData } from "./attempt.mjs";
import { RETRIEVAL_OFFERS } from "./retrieval.mjs";
import { BENCHMARK_CONTEXT, SCIFACT_PROFILE } from "./scifact.mjs";
import { DEMO_TERMS, quoteWindow } from "./terms.mjs";

const DAY = 86400n;

// Issues fundable quotes for public benchmark retrieval cases. The issuer key signs each
// quote. Caps bound what this process issues: every issued quote counts against the daily
// cap of its chain day, whether or not the buyer funds it. State is in memory only.
export function createQuoteIssuer({ account, domain, token, payees, caps, terms = DEMO_TERMS }) {
  const payee = Object.fromEntries(["connector", "executor", "evaluator", "evaluatorSigner"].map(key => [key, getAddress(payees[key])]));
  if (typeof caps?.maxPerAttempt !== "bigint" || typeof caps?.dailyCap !== "bigint" || caps.maxPerAttempt <= 0n || caps.dailyCap <= 0n) throw new RangeError("Issuance caps must be positive atomic amounts");
  const total = BigInt(terms.principal) + BigInt(terms.executionCap) + BigInt(terms.evaluationCap);
  if (total > caps.maxPerAttempt) throw new RangeError("Terms exceed the per-attempt cap");
  const issued = new Map();
  return Object.freeze({
    address: account.address,
    fundingTotal: total.toString(),
    issuedOn(day) { return (issued.get(BigInt(day)) ?? 0n).toString(); },
    async issue({ offerRef, caseRef, query, buyer, profileRef, issuedAt }) {
      if (!RETRIEVAL_OFFERS.some(o => o.offerRef === offerRef)) throw new TypeError("Unknown retrieval offer");
      if (typeof caseRef !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(caseRef)) throw new TypeError("Invalid benchmark case");
      const window = quoteWindow(profileRef, issuedAt);
      const day = BigInt(issuedAt) / DAY, used = issued.get(day) ?? 0n;
      if (used + total > caps.dailyCap) throw new RangeError("Daily issuance cap reached");
      const record = { schemaVersion: ATTEMPT_SCHEMA, offerRef, outcomeSpecRef: BENCHMARK_CONTEXT.outcomeSpecRef, contextRef: SCIFACT_PROFILE.profileRef,
        taskRef: `public-demo/${caseRef}`, principalRef: SCIFACT_PROFILE.principalRef, accessSnapshotRef: "public-demo-authorization/v1", termsRef: terms.termsRef,
        inputDigest: hashReference(query), sourceVersion: `0x${SCIFACT_PROFILE.corpusSha256}`, maxSources: 5, retryLimit: 0,
        executeBy: window.executeBy, principal: terms.principal, executionCap: terms.executionCap, evaluationCap: terms.evaluationCap };
      const salt = newAttemptId();
      const quote = { attemptId: newAttemptId(), recordCommitment: commitAttemptRecord(record, salt), policyHash: SETTLEMENT_POLICY_HASH,
        issuer: account.address, buyer: getAddress(buyer), connectorPayee: payee.connector, executorPayee: payee.executor,
        evaluatorPayee: payee.evaluator, evaluatorSigner: payee.evaluatorSigner, asset: getAddress(token.address),
        principal: terms.principal, executionCap: terms.executionCap, evaluationCap: terms.evaluationCap,
        quoteExpiresAt: window.quoteExpiresAt, executeBy: window.executeBy, settleBy: window.settleBy, timeoutMode: TIMEOUT_MODES.refund_all };
      bindRecordToQuote(record, salt, quote);
      const authorization = fundingAuthorizationTypedData({ token: { name: token.name, version: token.version, chainId: String(token.chainId), verifyingContract: token.address },
        domain, quote, validAfter: "0", validBefore: window.authorizationValidBefore });
      const issuerSignature = await account.signTypedData(quoteTypedData(domain, quote));
      issued.set(day, used + total);
      return { quote, issuerSignature, quoteDigest: quoteDigest(domain, quote), record, salt, authorization, profileRef };
    },
  });
}
