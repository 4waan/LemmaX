import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RECEIVE_AUTHORIZATION_TYPES } from "../src/attempt.mjs";
import { localMandateWallet } from "../src/buyer-wallet.mjs";
import { createDelivery } from "../src/delivery.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { createEvaluator } from "../src/evaluator.mjs";
import { createBuyerGuard } from "../src/guard.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { createPurchaseDesk } from "../src/purchase.mjs";
import { RETRIEVAL_OFFERS, createRetrievalIndex } from "../src/retrieval.mjs";
import { RULEBOOK, RULEBOOK_HASH, RULEBOOK_INDEX } from "../src/rulebook.mjs";
import { SCIFACT_PROFILE } from "../src/scifact.mjs";
import { usdcAtomic } from "../src/terms.mjs";
import { createWalletMcpServer } from "../src/wallet-mcp.mjs";
import { loadRetrievalReport } from "../scripts/verify-retrieval.mjs";

const SETTLEMENT = "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7", USDC = RULEBOOK.asset;
const domain = { chainId: "10143", verifyingContract: SETTLEMENT };
const token = { address: USDC, name: "USDC", version: "2", chainId: 10143 };

async function connect(t, server) {
  const client = new Client({ name: "buyer-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const call = async (client, name, args) => (await client.callTool({ name, arguments: args })).structuredContent;

test("The agent's wallet signs a bill only after the guard clears it, and names who refused otherwise", async t => {
  const issuerAccount = privateKeyToAccount(generatePrivateKey()), buyer = privateKeyToAccount(generatePrivateKey());
  const [main, b] = RULEBOOK.roles.evaluators;
  const issuer = createQuoteIssuer({ account: issuerAccount, domain, token, caps: { maxPerAttempt: usdcAtomic("0.25"), dailyCap: usdcAtomic("1") },
    payees: { connector: RULEBOOK.roles.connectors[0].address, executor: issuerAccount.address, evaluator: main.payee, evaluatorSigner: main.signer },
    evaluators: { "evaluator-b": { evaluator: b.payee, evaluatorSigner: b.signer } } });
  // The rulebook's issuer is a demo key this test does not hold, so it pins a copy naming the test key.
  const index = { ...RULEBOOK_INDEX, issuer: issuerAccount.address.toLowerCase(), executor: issuerAccount.address.toLowerCase(), operatorIncome: new Set([issuerAccount.address.toLowerCase()]) };
  let records = {};
  const audit = { partyRecords: async () => ({ records, freshness: { lagBlocks: 1, progressBlock: "100" } }) };
  const walletFor = maxValue => {
    const mandate = localMandateWallet({ account: buyer, chainId: 10143, usdc: USDC, settlement: SETTLEMENT, maxValue });
    const guard = createBuyerGuard({ buyer: buyer.address, domain, approvedIssuer: async () => issuerAccount.address, chainTime: async () => "1000",
      audit, conditionSets: mandate.conditionSets, setId: "local", index, pinnedRulebookHash: RULEBOOK_HASH });
    return { mandate, server: createWalletMcpServer({ guard, signer: mandate.signer, mode: "local", describe: async () => ({ address: buyer.address, usdc: "1", mon: "0" }) }) };
  };
  const bill = async evaluatorRef => {
    const i = await issuer.issue({ offerRef: "lemmax/tfidf-source-retrieval/v1", caseRef: "c1", query: "q", buyer: buyer.address, profileRef: "demo-standard/v1", issuedAt: "1000", evaluatorRef });
    return { quote: i.quote, issuerSignature: i.issuerSignature, buyerAuthorization: i.authorization };
  };

  const { mandate, server } = walletFor(8000n);
  const client = await connect(t, server);
  assert.deepEqual((await client.listTools()).tools.map(x => x.name), ["wallet_status", "wallet_sign_bill"]);
  assert.equal((await call(client, "wallet_status", {})).address, buyer.address);
  const honest = await bill();
  const signed = await call(client, "wallet_sign_bill", honest);
  assert.equal(signed.signed, true);
  const typed = { domain: { ...honest.buyerAuthorization.domain, chainId: 10143 }, types: RECEIVE_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message: honest.buyerAuthorization.message };
  assert.equal(await recoverTypedDataAddress({ ...typed, signature: signed.signature }), buyer.address);
  assert.deepEqual([signed.attemptId, signed.validBefore, signed.value], [honest.quote.attemptId, honest.buyerAuthorization.message.validBefore, "8000"]);
  // The approval covered that one signature: the same bill cannot be signed again behind the guard's back.
  await assert.rejects(mandate.signer.signFundingAuthorization(honest.buyerAuthorization), /not approved by the guard/);

  // A bill naming a checker with a blocking finding never reaches the wallet.
  records = { [b.signer.toLowerCase()]: { blocking: 1, rulebookHash: RULEBOOK_HASH } };
  assert.deepEqual(await call(client, "wallet_sign_bill", await bill("evaluator-b")), { signed: false, refusedBy: "guard", reasons: ["evaluator_flagged"] });
  // A payee edited after issue is caught before signing.
  const edited = { ...honest, buyerAuthorization: { ...honest.buyerAuthorization, message: { ...honest.buyerAuthorization.message, to: issuerAccount.address } } };
  assert.deepEqual((await call(client, "wallet_sign_bill", edited)).reasons, ["authorization_mismatch"]);
  // The agent's last settlement must already be on the public record.
  assert.deepEqual((await call(client, "wallet_sign_bill", { ...(await bill()), lastSettlementBlock: "101" })).reasons, ["index_behind_settlement"]);

  // With the guard satisfied, the wallet policy is the second lock.
  const strict = walletFor(7000n), strictClient = await connect(t, strict.server);
  const refused = await call(strictClient, "wallet_sign_bill", await bill());
  assert.deepEqual([refused.signed, refused.refusedBy], [false, "wallet policy (local signer)"]);
  assert.match(refused.reasons[0], /amount above the limit/);
});

test("Delivery runs the bought search, settles it once on chain and reports who was paid", async t => {
  const a = Object.fromEntries(["issuer", "evaluator", "buyer", "connector"].map(name => [name, privateKeyToAccount(generatePrivateKey())]));
  const contract = "0x1000000000000000000000000000000000000001";
  const local = { chainId: "10143", verifyingContract: contract };
  const issuer = createQuoteIssuer({ account: a.issuer, domain: local, token: { ...token, address: USDC }, caps: { maxPerAttempt: 8000n, dailyCap: 80000n },
    payees: { connector: a.connector.address, executor: a.issuer.address, evaluator: a.evaluator.address, evaluatorSigner: a.evaluator.address } });
  const documents = [{ id: "d1", title: "", text: "aspirin reduces fever", location: "urn:fixture:d1", sourceVersion: SCIFACT_PROFILE.corpusSha256, authorizedPrincipals: [SCIFACT_PROFILE.principalRef] }];
  const data = { documents, queries: new Map([["hit", "aspirin fever"]]), gold: new Map([["hit", new Set(["d1"])]]) };
  const index = createRetrievalIndex({ documents, principalRef: SCIFACT_PROFILE.principalRef, sourceVersion: SCIFACT_PROFILE.corpusSha256 });
  const settles = [], states = new Map();
  const settlement = {
    address: contract,
    async attemptInfo(id) { return { quoteDigest: `0x${"11".repeat(32)}`, fundedAt: "1000", state: states.get(id) ?? "none" }; },
    async settle({ quote, receipt }) { settles.push(receipt); states.set(quote.attemptId, "settled_success"); return { hash: `0x${"cd".repeat(32)}`, blockNumber: 17n }; },
    async credit() { return 0n; },
  };
  const desk = createPurchaseDesk({ issuer, settlement, relayer: {}, data, chainTime: async () => "1000", confirm: async () => ({ stage: "verified" }) });
  const delivery = createDelivery({ desk, settlement, evaluator: createEvaluator({ account: a.evaluator, domain: local, index, data }), evaluatorWallet: {},
    publicClient: { getContractEvents: async () => [] }, chainTime: async () => "1001", confirm: async () => ({ stage: "verified" }), explorer: "https://testnet.monadvision.com" });
  const report = loadRetrievalReport();
  const client = await connect(t, createMcpServer(createPublicDirectory({ report, index, data, asOf: () => report.observedAt }), Object.freeze({ ...desk, deliver: delivery.deliver })));
  assert.ok((await client.listTools()).tools.some(x => x.name === "lemma_deliver_attempt"));
  const q = await call(client, "lemma_quote_attempt", { offerRef: RETRIEVAL_OFFERS[1].offerRef, caseRef: "hit", profileRef: "demo-standard/v1", buyer: a.buyer.address });

  const early = await client.callTool({ name: "lemma_deliver_attempt", arguments: { attemptId: q.attemptId } });
  assert.deepEqual([early.isError, early.content[0].text], [true, "Request rejected: Attempt is not funded yet"]);
  states.set(q.attemptId, "funded");
  const progress = [];
  const done = (await client.callTool({ name: "lemma_deliver_attempt", arguments: { attemptId: q.attemptId } }, undefined, { onprogress: p => progress.push(p.message) })).structuredContent;
  assert.deepEqual([done.outcome, done.settled, done.relevant, done.sources[0].sourceRef, done.block], ["success", true, true, "d1", "17"]);
  assert.equal(done.link, `https://testnet.monadvision.com/tx/0x${"cd".repeat(32)}`);
  assert.deepEqual(done.payouts.map(p => [p.role, p.earned]), [["provider", "0.005"], ["LemmaX (execution)", "0.0015"], ["checker", "0.0008"], ["buyer (returned)", "0.0007"]]);
  assert.deepEqual(progress, ["Searching", "Checked: hit", "Settled"]);
  assert.deepEqual([done.cost.held, done.cost.returned, done.cost.net], ["0.008", "0.0007", "0.0073"]);
  assert.match(done.cost.returnedTo, /credit on the settlement contract .* once it reaches 0\.01 USDC/);
  assert.equal(settles.length, 1);
  // Settled attempts cannot be delivered twice, and only this desk's quotes can be delivered at all.
  assert.equal((await client.callTool({ name: "lemma_deliver_attempt", arguments: { attemptId: q.attemptId } })).content[0].text, "Request rejected: Attempt is already settled or refunded");
  assert.equal((await client.callTool({ name: "lemma_deliver_attempt", arguments: { attemptId: `0x${"77".repeat(32)}` } })).content[0].text, "Request rejected: Unknown quote");
  assert.equal(settles.length, 1);
});
