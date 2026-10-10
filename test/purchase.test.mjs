import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { FIXTURE_TOKEN } from "./fixtures/attempt.mjs";
import { bindRecordToQuote, normalizeAttemptRecord, quoteDigest, verifyQuote, verifyReceipt } from "../src/attempt.mjs";
import { DEADLINE_PROFILES, DEMO_TERMS, formatUsdc, quoteWindow, usdcAtomic } from "../src/terms.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { createEvaluator } from "../src/evaluator.mjs";
import { createPurchaseDesk } from "../src/purchase.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { SettlementRejected } from "../src/settlement.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { SCIFACT_PROFILE } from "../src/scifact.mjs";
import { RETRIEVAL_OFFERS, createRetrievalIndex } from "../src/retrieval.mjs";
import { loadRetrievalReport } from "../scripts/verify-retrieval.mjs";

const accounts = () => Object.fromEntries(["issuer", "evaluator", "buyer", "connector", "executor"].map(name => [name, privateKeyToAccount(generatePrivateKey())]));
const domain = { chainId: "10143", verifyingContract: "0x1000000000000000000000000000000000000001" };
const token = { address: FIXTURE_TOKEN, name: "USDC", version: "2", chainId: 10143 };
const doc = (id, text) => ({ id, title: "", text, location: `urn:fixture:${id}`, sourceVersion: SCIFACT_PROFILE.corpusSha256, authorizedPrincipals: [SCIFACT_PROFILE.principalRef] });
const documents = [doc("d1", "aspirin reduces fever"), doc("d2", "vitamin d supports bone health"), doc("d3", "unrelated text about rivers")];
const data = { documents, queries: new Map([["hit", "aspirin fever"], ["miss", "rivers"]]), gold: new Map([["hit", new Set(["d1"])], ["miss", new Set(["d2"])]]) };
const index = createRetrievalIndex({ documents, principalRef: SCIFACT_PROFILE.principalRef, sourceVersion: SCIFACT_PROFILE.corpusSha256 });
const caps = { maxPerAttempt: usdcAtomic("0.25"), dailyCap: usdcAtomic("1.00") };
const offerRef = RETRIEVAL_OFFERS[1].offerRef;
function issuerFor(a, overrides = {}) {
  return createQuoteIssuer({ account: a.issuer, domain, token, caps, ...overrides,
    payees: { connector: a.connector.address, executor: a.executor.address, evaluator: a.evaluator.address, evaluatorSigner: a.evaluator.address } });
}

test("USDC caps parse exactly and deadline profiles derive ordered windows", () => {
  assert.equal(usdcAtomic("0.25"), 250000n); assert.equal(usdcAtomic("1.00"), 1000000n); assert.equal(usdcAtomic("12"), 12000000n);
  for (const bad of ["0.1234567", "-1", "1e3", ".5", "01", "", 1, "1.", "0x10"]) assert.throws(() => usdcAtomic(bad));
  assert.equal(formatUsdc(8000n), "0.008"); assert.equal(formatUsdc("5000000"), "5");
  assert.deepEqual(quoteWindow("demo-standard/v1", "1000"), { quoteExpiresAt: "1120", executeBy: "1240", settleBy: "1600", authorizationValidBefore: "1121" });
  assert.deepEqual(quoteWindow("demo-timeout/v1", "1000"), { quoteExpiresAt: "1060", executeBy: "1120", settleBy: "1180", authorizationValidBefore: "1061" });
  assert.throws(() => quoteWindow("toString", "1000"), /Unknown deadline profile/);
  assert.deepEqual(Object.keys(DEADLINE_PROFILES), ["demo-standard/v1", "demo-timeout/v1"]);
  assert.equal(BigInt(DEMO_TERMS.principal) + BigInt(DEMO_TERMS.executionCap) + BigInt(DEMO_TERMS.evaluationCap), 8000n);
});

test("Issuer signs bound quotes and buyer authorizations and enforces per-attempt and daily caps", async () => {
  const a = accounts(), issuer = issuerFor(a);
  const issued = await issuer.issue({ offerRef, caseRef: "hit", query: "aspirin fever", buyer: a.buyer.address, profileRef: "demo-standard/v1", issuedAt: "172800" });
  assert.equal(await verifyQuote({ domain, quote: issued.quote, signature: issued.issuerSignature, approvedIssuer: a.issuer.address, now: "172800" }), true);
  assert.equal(bindRecordToQuote(issued.record, issued.salt, issued.quote), true);
  assert.deepEqual(normalizeAttemptRecord(issued.record).termsRef, DEMO_TERMS.termsRef);
  assert.deepEqual([issued.quote.principal, issued.quote.executionCap, issued.quote.evaluationCap, issued.quote.asset], ["5000", "2000", "1000", FIXTURE_TOKEN]);
  assert.deepEqual(issued.authorization.message, { from: a.buyer.address, to: domain.verifyingContract, value: "8000", validAfter: "0", validBefore: "172921", nonce: quoteDigest(domain, issued.quote) });
  assert.equal(issuer.issuedOn(2), "8000");
  const tight = issuerFor(a, { caps: { maxPerAttempt: 8000n, dailyCap: 16000n } });
  const issue = (day, caseRef = "hit") => tight.issue({ offerRef, caseRef, query: "q", buyer: a.buyer.address, profileRef: "demo-timeout/v1", issuedAt: String(day * 86400 + 5) });
  await issue(1); await issue(1);
  await assert.rejects(issue(1), /Daily issuance cap reached/);
  await issue(2);
  assert.throws(() => issuerFor(a, { caps: { maxPerAttempt: 7999n, dailyCap: 16000n } }), /per-attempt cap/);
  assert.throws(() => issuerFor(a, { caps: { maxPerAttempt: 0n, dailyCap: 1n } }), /positive/);
  await assert.rejects(issue(3, "../etc"), /Invalid benchmark case/);
  // Concurrent requests reserve before signing, so only the cap's worth succeeds.
  const raced = await Promise.allSettled([issue(5), issue(5), issue(5)]);
  assert.deepEqual(raced.map(x => x.status), ["fulfilled", "fulfilled", "rejected"]);
  assert.equal(tight.issuedOn(5), "16000");
  const failing = issuerFor({ ...a, issuer: { address: a.issuer.address, signTypedData: async () => { throw new Error("signer offline"); } } },
    { caps: { maxPerAttempt: 8000n, dailyCap: 8000n } });
  await assert.rejects(failing.issue({ offerRef, caseRef: "hit", query: "q", buyer: a.buyer.address, profileRef: "demo-timeout/v1", issuedAt: "86405" }), /signer offline/);
  assert.equal(failing.issuedOn(1), "0");
  await assert.rejects(tight.issue({ offerRef: "unknown/v1", caseRef: "hit", query: "q", buyer: a.buyer.address, profileRef: "demo-timeout/v1", issuedAt: "999999" }), /Unknown retrieval offer/);
});

test("Evaluator signs success or eligible failure within the window and refuses mismatched tasks", async () => {
  const a = accounts(), issuer = issuerFor(a), evaluator = createEvaluator({ account: a.evaluator, domain, index, data });
  const run = async caseRef => {
    const issued = await issuer.issue({ offerRef, caseRef, query: data.queries.get(caseRef), buyer: a.buyer.address, profileRef: "demo-standard/v1", issuedAt: "1000" });
    return { issued, result: await evaluator.evaluate({ ...issued, caseRef, fundedAt: "1010", chainTime: "1030" }) };
  };
  for (const [caseRef, outcome] of [["hit", "success"], ["miss", "eligible_failure"]]) {
    const { issued, result } = await run(caseRef);
    assert.equal(result.outcome, outcome);
    assert.deepEqual([result.receipt.executionUsed, result.receipt.evaluationUsed], [DEMO_TERMS.executionCharge, DEMO_TERMS.evaluationCharge]);
    assert.equal(await verifyReceipt({ domain, quote: issued.quote, receipt: result.receipt, signature: result.signature, fundedAt: "1010", now: "1030" }), true);
    assert.ok(result.evidence.sources.length <= 5);
  }
  const { issued } = await run("hit");
  await assert.rejects(evaluator.evaluate({ ...issued, caseRef: "miss", fundedAt: "1010", chainTime: "1030" }), /does not match/);
  await assert.rejects(evaluator.evaluate({ ...issued, caseRef: "hit", fundedAt: "1010", chainTime: "1241" }), /execution window/);
  await assert.rejects(evaluator.evaluate({ ...issued, caseRef: "hit", fundedAt: "1031", chainTime: "1030" }), /execution window/);
  await assert.rejects(evaluator.evaluate({ ...issued, salt: issued.quote.attemptId, caseRef: "hit", fundedAt: "1010", chainTime: "1030" }), /commitment/);
  const other = createEvaluator({ account: a.buyer, domain, index, data });
  await assert.rejects(other.evaluate({ ...issued, caseRef: "hit", fundedAt: "1010", chainTime: "1030" }), /different evaluator/);
});

test("Agreed-terms scenarios rank offers against the declared buyer alternative", () => {
  const report = loadRetrievalReport();
  const directory = createPublicDirectory({ report, index, data: { documents, queries: data.queries, gold: data.gold }, asOf: () => report.observedAt });
  const expensive = directory.assess({ profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: "demo-terms-llm-reads-corpus/v1" });
  const cheap = directory.assess({ profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: "demo-terms-own-pipeline/v1" });
  const byOffer = result => Object.fromEntries(result.results.map(r => [r.offerRef.split("/")[1], r]));
  const e = byOffer(expensive), c = byOffer(cheap);
  assert.equal(e["tfidf-source-retrieval"].rank, 1);
  assert.ok(Math.abs(e["tfidf-source-retrieval"].cReuse - 0.0521) < 0.0001 && Math.abs(e["bm25-source-retrieval"].cReuse - 0.0559) < 0.0001);
  assert.ok(e["tfidf-source-retrieval"].expectedSaving > 0.14 && e["tfidf-source-retrieval"].expectedSaving < 0.143);
  assert.ok(Object.values(c).every(r => r.expectedSaving < 0));
  assert.ok(expensive.results.every(r => r.currency === "USDC" && !("contribution" in r)));
  assert.equal(expensive.fundable, false);
  assert.match(expensive.assumptions[1], /lemmax-demo-terms\/v1/);
});

test("MCP purchase tools exist only with a desk and return specific rejection reasons", async t => {
  const report = loadRetrievalReport(), a = accounts();
  const directory = createPublicDirectory({ report, index, data, asOf: () => report.observedAt });
  const issuer = issuerFor(a, { caps: { maxPerAttempt: 8000n, dailyCap: 8000n } });
  const funded = [];
  const settlement = {
    async fund({ quote, authorization }) {
      if (authorization.signature.length < 132) throw new SettlementRejected("fund", "FiatTokenV2: invalid signature");
      funded.push(quote.attemptId); return { hash: `0x${"ab".repeat(32)}`, blockNumber: 7n, blockHash: `0x${"cd".repeat(32)}`, gasUsed: 282450n, gasLimit: 313088n };
    },
    async attemptInfo(attemptId) { return { quoteDigest: `0x${"11".repeat(32)}`, fundedAt: "1010", state: funded.includes(attemptId) ? "funded" : "none" }; },
  };
  let now = "1000", release;
  const desk = createPurchaseDesk({ issuer, settlement, relayer: {}, data, chainTime: async () => now,
    confirm: async () => { if (release) await release; return { stage: "verified" }; } });
  const connect = async withDesk => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(directory, withDesk ? desk : null), client = new Client({ name: "buyer-agent", version: "1.0.0" });
    await server.connect(serverTransport); await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });
    return client;
  };
  assert.equal((await (await connect(false)).listTools()).tools.length, 5);
  const client = await connect(true);
  assert.deepEqual((await client.listTools()).tools.map(x => x.name).slice(5), ["lemma_quote_attempt", "lemma_fund_attempt", "lemma_attempt_status"]);
  const quoted = await client.callTool({ name: "lemma_quote_attempt", arguments: { offerRef, caseRef: "hit", profileRef: "demo-standard/v1", buyer: a.buyer.address } });
  const q = quoted.structuredContent;
  assert.equal(q.fundingTotal, "8000"); assert.equal(q.buyerAuthorization.domain.chainId, "10143");
  const signature = await a.buyer.signTypedData({ ...q.buyerAuthorization, domain: { ...q.buyerAuthorization.domain, chainId: 10143 } });
  const fund = args => client.callTool({ name: "lemma_fund_attempt", arguments: { attemptId: q.attemptId, validAfter: "0", validBefore: q.buyerAuthorization.message.validBefore, ...args } });
  now = "1116";
  assert.match((await fund({ signature })).content[0].text, /Request rejected: Quote expires too soon to relay safely/);
  now = "1000";
  let open; release = new Promise(resolve => { open = resolve; });
  const first = fund({ signature });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match((await fund({ signature })).content[0].text, /Funding already in progress/);
  open(); release = null;
  const ok = await first;
  assert.deepEqual([ok.structuredContent.state, ok.structuredContent.confirmation, ok.structuredContent.blockNumber], ["funded", "verified", "7"]);
  assert.match((await fund({ signature })).content[0].text, /already funded or closed/);
  assert.equal(funded.length, 1);
  assert.equal((await client.callTool({ name: "lemma_attempt_status", arguments: { attemptId: q.attemptId } })).structuredContent.state, "funded");
  const unknown = await client.callTool({ name: "lemma_fund_attempt", arguments: { attemptId: `0x${"22".repeat(32)}`, validAfter: "0", validBefore: "1", signature } });
  assert.match(unknown.content[0].text, /Request rejected: Unknown quote/);
  const capped = await client.callTool({ name: "lemma_quote_attempt", arguments: { offerRef, caseRef: "miss", profileRef: "demo-timeout/v1", buyer: a.buyer.address } });
  assert.match(capped.content[0].text, /Daily issuance cap reached/);
  const badArgs = await client.callTool({ name: "lemma_quote_attempt", arguments: { offerRef, caseRef: "hit", profileRef: "demo-forever/v1", buyer: a.buyer.address } });
  assert.equal(badArgs.isError, true);
});
