import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, createVerify } from "node:crypto";
import { generateAuthorizationSignature, formatRequestForAuthorizationSignature } from "@privy-io/node";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RECEIVE_AUTHORIZATION_TYPES, quoteDigest } from "../src/attempt.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { createBuyerGuard } from "../src/guard.mjs";
import { RULEBOOK, RULEBOOK_HASH } from "../src/rulebook.mjs";
import { buyerPrivyKeys, createConditionSetClient, createPrivyBuyerSigner, mandatePolicy, normalizedSignature, p256KeyPair } from "../src/privy-buyer.mjs";
import { deriveP256Key, evaluatorBAccount } from "../src/keys.mjs";
import { usdcAtomic } from "../src/terms.mjs";

const SETTLEMENT = "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7", USDC = RULEBOOK.asset;
const domain = { chainId: "10143", verifyingContract: SETTLEMENT };
const token = { address: USDC, name: "USDC", version: "2", chainId: 10143 };

test("Buyer-side Privy keys derive deterministically into the DER formats Privy accepts", () => {
  const env = { BENCHMARK_BUYER_PRIVATE_KEY: generatePrivateKey() };
  const keys = buyerPrivyKeys(env);
  assert.deepEqual(keys, buyerPrivyKeys(env));
  assert.equal(new Set([keys.principal.publicKey, keys.agent.publicKey, keys.guard.publicKey]).size, 3);
  // A request signed with the derived key verifies under the derived public key, as Privy checks it.
  const input = { version: 1, method: "POST", url: "https://api.privy.io/v1/condition_sets/x/condition_set_items", body: [{ value: "0xab" }], headers: { "privy-app-id": "app" } };
  const signature = generateAuthorizationSignature({ authorizationPrivateKey: keys.guard.privateKey, input });
  const verifier = createVerify("SHA256"); verifier.update(formatRequestForAuthorizationSignature(input));
  assert.equal(verifier.verify(createPublicKey({ key: Buffer.from(keys.guard.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(signature, "base64")), true);
  assert.throws(() => buyerPrivyKeys({}), /BENCHMARK_BUYER_PRIVATE_KEY/);
  assert.equal(p256KeyPair(deriveP256Key(env.BENCHMARK_BUYER_PRIVATE_KEY, "lemmax/privy/agent/v1")).publicKey, keys.agent.publicKey);
  assert.notEqual(evaluatorBAccount({ EVALUATOR_PRIVATE_KEY: env.BENCHMARK_BUYER_PRIVATE_KEY }).address, privateKeyToAccount(env.BENCHMARK_BUYER_PRIVATE_KEY).address);
});

test("The mandate is one ALLOW rule pinning chain, token, payee, value and the approved-digest set", () => {
  const policy = mandatePolicy({ chainId: 10143, usdc: USDC, settlement: SETTLEMENT, maxValue: "8000", conditionSetId: "set-1" });
  assert.equal(policy.rules.length, 1);
  const [rule] = policy.rules;
  assert.deepEqual([rule.method, rule.action], ["eth_signTypedData_v4", "ALLOW"]);
  assert.deepEqual(rule.conditions.map(c => [c.field_source, c.field, c.operator, c.value]), [
    ["ethereum_typed_data_domain", "chainId", "eq", "10143"], ["ethereum_typed_data_domain", "verifyingContract", "eq", USDC],
    ["ethereum_typed_data_message", "to", "eq", SETTLEMENT], ["ethereum_typed_data_message", "value", "lte", "8000"],
    ["ethereum_typed_data_message", "nonce", "in_condition_set", "set-1"]]);
  assert.ok(rule.conditions.filter(c => c.typed_data).every(c => c.typed_data.types === RECEIVE_AUTHORIZATION_TYPES && c.typed_data.primary_type === "ReceiveWithAuthorization"));
});

test("Condition-set writes carry the owner's request signature and lowercase digests", async () => {
  const keys = buyerPrivyKeys({ BENCHMARK_BUYER_PRIVATE_KEY: generatePrivateKey() }), calls = [];
  const client = createConditionSetClient({ appId: "app-1", appSecret: "secret", ownerPrivateKey: keys.guard.privateKey, sign: generateAuthorizationSignature, now: () => 1000,
    fetchImpl: async (url, init) => { calls.push({ url, ...init }); return { ok: true, text: async () => JSON.stringify([{ id: "item-1", value: "0xab" }]) }; } });
  const items = await client.add("set-1", ["0xAB"]);
  assert.deepEqual(items, [{ id: "item-1", value: "0xab" }]);
  const [call] = calls;
  assert.deepEqual([call.url, call.method, JSON.parse(call.body)], ["https://api.privy.io/v1/condition_sets/set-1/condition_set_items", "POST", [{ value: "0xab" }]]);
  assert.equal(call.headers["privy-request-expiry"], "61000");
  const input = { version: 1, method: "POST", url: call.url, body: [{ value: "0xab" }], headers: { "privy-app-id": "app-1", "privy-request-expiry": "61000" } };
  const verifier = createVerify("SHA256"); verifier.update(formatRequestForAuthorizationSignature(input));
  assert.equal(verifier.verify(createPublicKey({ key: Buffer.from(keys.guard.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(call.headers["privy-authorization-signature"], "base64")), true);
});

test("Wallet signatures are normalized to v 27/28, must be low-s and must recover to the buyer", async () => {
  const buyer = privateKeyToAccount(generatePrivateKey());
  const typed = { domain: { name: "USDC", version: "2", chainId: 10143, verifyingContract: USDC }, types: RECEIVE_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization",
    message: { from: buyer.address, to: SETTLEMENT, value: "8000", validAfter: "0", validBefore: "2000", nonce: `0x${"aa".repeat(32)}` } };
  const signature = await buyer.signTypedData(typed);
  const v01 = `${signature.slice(0, 130)}${(parseInt(signature.slice(130), 16) - 27).toString(16).padStart(2, "0")}`;
  assert.equal(await normalizedSignature(typed, v01, buyer.address), signature);
  await assert.rejects(normalizedSignature(typed, signature, privateKeyToAccount(generatePrivateKey()).address), /does not recover/);
  await assert.rejects(normalizedSignature(typed, `${signature.slice(0, 66)}${"f".repeat(64)}1b`, buyer.address), /non-canonical/);
  // The Privy signer forwards the exact typed data with the agent key only.
  const seen = [];
  const privy = { wallets: () => ({ ethereum: () => ({ async signTypedData(walletId, input) { seen.push({ walletId, input }); return { signature: v01, encoding: "hex" }; } }) }) };
  const signer = createPrivyBuyerSigner({ privy, walletId: "w-1", address: buyer.address, agentPrivateKey: "agent-key" });
  assert.equal(await signer.signFundingAuthorization({ ...typed, domain: { ...typed.domain, chainId: "10143" } }), signature);
  assert.deepEqual([seen[0].walletId, seen[0].input.params.typed_data.primary_type, seen[0].input.params.typed_data.domain.chainId, seen[0].input.authorization_context],
    ["w-1", "ReceiveWithAuthorization", 10143, { authorization_private_keys: ["agent-key"] }]);
});

test("The guard approves only honest, rulebook-conformant quotes from clean parties under a fresh index", async () => {
  const issuerAccount = privateKeyToAccount(generatePrivateKey()), buyer = privateKeyToAccount(generatePrivateKey());
  const roles = RULEBOOK.roles, [main, b] = roles.evaluators;
  // A rulebook-shaped issuer: the rulebook's issuer address is a demo key we do not hold, so
  // the test pins a copy of the index whose issuer is this test key.
  const issuer = createQuoteIssuer({ account: issuerAccount, domain, token, caps: { maxPerAttempt: usdcAtomic("0.25"), dailyCap: usdcAtomic("1") },
    payees: { connector: roles.connectors[0].address, executor: issuerAccount.address, evaluator: main.payee, evaluatorSigner: main.signer },
    evaluators: { "evaluator-b": { evaluator: b.payee, evaluatorSigner: b.signer } } });
  const { RULEBOOK_INDEX } = await import("../src/rulebook.mjs");
  const index = { ...RULEBOOK_INDEX, issuer: issuerAccount.address.toLowerCase(), executor: issuerAccount.address.toLowerCase(), operatorIncome: new Set([issuerAccount.address.toLowerCase()]) };
  const added = [], removed = [];
  const conditionSets = { add: async (setId, values) => { added.push(...values); return values.map((v, i) => ({ id: `item-${added.length + i}`, value: v })); }, remove: async (setId, id) => removed.push(id) };
  let records = {}, lagBlocks = 2, auditDown = false;
  const audit = { partyRecords: async () => { if (auditDown) throw new Error("down"); return { records, freshness: { lagBlocks } }; } };
  const guard = (options = {}) => createBuyerGuard({ buyer: buyer.address, domain, approvedIssuer: async () => issuerAccount.address, chainTime: async () => "1000",
    audit, conditionSets, setId: "set-1", index, pinnedRulebookHash: RULEBOOK_HASH, ...options });
  const quoted = async evaluatorRef => {
    const i = await issuer.issue({ offerRef: "lemmax/tfidf-source-retrieval/v1", caseRef: "c1", query: "q", buyer: buyer.address, profileRef: "demo-standard/v1", issuedAt: "1000", evaluatorRef });
    return { quote: i.quote, issuerSignature: i.issuerSignature, buyerAuthorization: i.authorization };
  };
  const honest = await quoted();
  const approval = await guard().approve(honest);
  assert.deepEqual([approval.approved, approval.digest, added], [true, quoteDigest(domain, honest.quote), [quoteDigest(domain, honest.quote)]]);
  await guard().release(approval);
  assert.deepEqual(removed, [approval.itemId]);
  assert.deepEqual((await guard().approve({ ...honest, quote: { ...honest.quote, principal: "1000", executionCap: "6000" } })).reasons, ["issuer_signature_or_expiry"]);
  assert.deepEqual((await guard().approve({ ...honest, buyerAuthorization: { ...honest.buyerAuthorization, message: { ...honest.buyerAuthorization.message, to: issuerAccount.address } } })).reasons, ["authorization_mismatch"]);
  const other = privateKeyToAccount(generatePrivateKey());
  assert.deepEqual((await createBuyerGuard({ buyer: other.address, domain, approvedIssuer: async () => issuerAccount.address, chainTime: async () => "1000", audit, conditionSets, setId: "s", index, pinnedRulebookHash: RULEBOOK_HASH }).approve(honest)).reasons, ["wrong_buyer"]);
  records = { [b.signer.toLowerCase()]: { blocking: 1, rulebookHash: RULEBOOK_HASH } };
  assert.deepEqual((await guard().approve(await quoted("evaluator-b"))).reasons, ["evaluator_flagged"]);
  assert.equal((await guard().approve(honest)).approved, true);
  lagBlocks = 31;
  assert.deepEqual((await guard().approve(honest)).reasons, ["index_stale"]);
  auditDown = true;
  assert.deepEqual((await guard().approve(honest)).reasons, ["index_unavailable"]);
  assert.equal((await guard({ auditRequired: false }).approve(honest)).approved, true);
  assert.deepEqual((await guard({ pinnedRulebookHash: `0x${"00".repeat(32)}` }).approve(honest)).reasons, ["rulebook_changed"]);
  assert.throws(() => createQuoteIssuer({ account: issuerAccount, domain, token, caps: { maxPerAttempt: 8000n, dailyCap: 8000n },
    payees: { connector: roles.connectors[0].address, executor: issuerAccount.address, evaluator: issuerAccount.address, evaluatorSigner: issuerAccount.address } }), /cannot also be an evaluator/);
  await assert.rejects(issuer.issue({ offerRef: "lemmax/tfidf-source-retrieval/v1", caseRef: "c1", query: "q", buyer: buyer.address, profileRef: "demo-standard/v1", issuedAt: "1000", evaluatorRef: "nobody" }), /Unknown evaluator/);
});
