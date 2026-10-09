import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileSettlement } from "./compile-settlement.mjs";
import { attemptFixture } from "../test/fixtures/attempt.mjs";
import { quoteDigest, quoteTypedData, receiptTypedData, newAttemptId, allocateReceipt, commitAttemptRecord, bindRecordToQuote } from "../src/attempt.mjs";
import { digest } from "../src/retrieval.mjs";

const binary = process.env.LEMMAX_ANVIL_BIN ?? "anvil";
const version = execFileSync(binary, ["--version"], { encoding: "utf8" });
const match = /Version:\s*(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 8)) throw new Error("Use official Anvil v1.8 or newer for Monad execution tests");
const artifact = compileSettlement(true);
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
const child = spawn(binary, ["--network", "monad", "--hardfork", "MonadTen", "--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--accounts", "0", "--silent"], { stdio: ["ignore", "ignore", "pipe"] });
let nodeError = ""; child.stderr.on("data", data => { nodeError = (nodeError + data).slice(-4096); });
const rpc = `http://127.0.0.1:${port}`;
const chain = defineChain({ id: 31337, name: "Local Monad execution", nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const publicClient = createPublicClient({ chain, pollingInterval: 25, cacheTime: 0, transport: http(rpc, { retryCount: 0 }) });
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Local test node exited: ${nodeError}`);
    try { ready = await publicClient.getChainId() === 31337; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Local Monad test node did not start");
  const fixture = attemptFixture();
  const issuer = fixture.issuer, buyer = fixture.buyer, evaluator = fixture.evaluator;
  const connector = privateKeyToAccount(generatePrivateKey()), executor = privateKeyToAccount(generatePrivateKey());
  for (const account of [issuer, buyer, evaluator, connector, executor]) await publicClient.request({ method: "anvil_setBalance", params: [account.address, "0x3635c9adc5dea00000"] });
  const wallet = account => createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) });
  const deploy = await wallet(issuer).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [issuer.address] });
  const deployed = await publicClient.waitForTransactionReceipt({ hash: deploy });
  eq(deployed.status, "success");
  const contract = deployed.contractAddress;
  const domain = { chainId: "31337", verifyingContract: contract };
  const read = (name, args = []) => publicClient.readContract({ address: contract, abi: artifact.abi, functionName: name, args });
  const send = async (account, name, args = [], value = 0n) => {
    const hash = await wallet(account).writeContract({ address: contract, abi: artifact.abi, functionName: name, args, value });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    eq(receipt.status, "success"); return receipt;
  };
  const expectRevert = async action => { await assert.rejects(action); checks++; };
  const quote = async () => {
    const now = (await publicClient.getBlock()).timestamp;
    const record = { ...fixture.record, executeBy: String(now + 120n) }; const salt = newAttemptId();
    const q = { ...fixture.quote, attemptId: newAttemptId(), recordCommitment: commitAttemptRecord(record, salt), connectorPayee: connector.address, executorPayee: executor.address,
      quoteExpiresAt: String(now + 60n), executeBy: String(now + 120n), settleBy: String(now + 180n) };
    bindRecordToQuote(record, salt, q); return q;
  };
  const signed = q => issuer.signTypedData(quoteTypedData(domain, q));
  const receiptFor = async (q, outcome) => {
    const now = (await publicClient.getBlock()).timestamp.toString();
    return { ...fixture.receipt, attemptId: q.attemptId, quoteDigest: quoteDigest(domain, q), outcome, completedAt: now, evaluatedAt: now };
  };
  const signReceipt = r => evaluator.signTypedData(receiptTypedData(domain, r));
  const q1 = await quote(); const sig1 = await signed(q1);
  eq(await read("quoteDigest", [q1]), quoteDigest(domain, q1));
  await expectRevert(() => send(issuer, "fund", [q1, sig1], 130n));
  await expectRevert(() => send(buyer, "fund", [q1, sig1], 129n));
  const changed = { ...q1, principal: "101" };
  await expectRevert(() => send(buyer, "fund", [changed, sig1], 131n));
  const crossChain = await issuer.signTypedData(quoteTypedData({ ...domain, chainId: "31338" }, q1));
  await expectRevert(() => send(buyer, "fund", [q1, crossChain], 130n));
  await send(buyer, "fund", [q1, sig1], 130n);
  await expectRevert(() => send(buyer, "fund", [q1, sig1], 130n));
  eq(await read("lockedFunds"), 130n);
  const r1 = await receiptFor(q1, 1);
  eq(await read("receiptDigest", [r1]), hashTypedData(receiptTypedData(domain, r1)));
  await expectRevert(async () => send(buyer, "settle", [r1, await issuer.signTypedData(receiptTypedData(domain, r1))]));
  for (const change of [{ executionUsed: "21" }, { evaluationUsed: "11" }, { outcome: 3 }, { quoteDigest: newAttemptId() }, { completedAt: "0" }]) {
    const bad = { ...r1, ...change };
    await expectRevert(async () => send(buyer, "settle", [bad, await signReceipt(bad)]));
  }
  await expectRevert(() => send(buyer, "refundTimeout", [q1.attemptId]));
  const receiptSignature = await signReceipt(r1);
  await send(buyer, "settle", [r1, receiptSignature]);
  eq(await read("attemptState", [q1.attemptId]), 2);
  const allocation = allocateReceipt({ domain, quote: q1, receipt: r1 });
  for (const [owner, key] of [[connector, "connector"], [executor, "executor"], [evaluator, "evaluator"], [buyer, "buyerCredit"]]) eq(await read("credit", [owner.address]), BigInt(allocation[key]));
  eq(await read("totalCredit"), 130n); eq(await read("lockedFunds"), 0n);
  await expectRevert(() => send(buyer, "settle", [r1, receiptSignature]));
  await expectRevert(() => send(buyer, "refundTimeout", [q1.attemptId]));

  const q2 = await quote(); await send(buyer, "fund", [q2, await signed(q2)], 130n);
  const r2 = await receiptFor(q2, 2); await send(buyer, "settle", [r2, await signReceipt(r2)]);
  eq(await read("attemptState", [q2.attemptId]), 3);
  eq(await read("credit", [buyer.address]), 140n); eq(await read("credit", [connector.address]), 100n);
  eq(await read("credit", [executor.address]), 14n); eq(await read("credit", [evaluator.address]), 6n);
  const beforeBalance = await publicClient.getBalance({ address: connector.address });
  await send(buyer, "withdraw", [140n, connector.address]);
  eq(await publicClient.getBalance({ address: connector.address }), beforeBalance + 140n);
  eq(await read("credit", [buyer.address]), 0n);
  await expectRevert(() => send(buyer, "withdraw", [1n, buyer.address]));

  const q3 = await quote(); await send(buyer, "fund", [q3, await signed(q3)], 130n);
  await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(q3.settleBy) + 1] });
  await publicClient.request({ method: "evm_mine", params: [] });
  const late = { ...await receiptFor(q3, 1), completedAt: q3.executeBy, evaluatedAt: q3.executeBy };
  await expectRevert(async () => send(buyer, "settle", [late, await signReceipt(late)]));
  await send(executor, "refundTimeout", [q3.attemptId]);
  eq(await read("attemptState", [q3.attemptId]), 4); eq(await read("credit", [buyer.address]), 130n);
  eq(await read("lockedFunds"), 0n);
  await expectRevert(() => send(buyer, "refundTimeout", [q3.attemptId]));
  const deployFixture = async (name, args = []) => {
    const compiled = artifact.testFixtures[name];
    const hash = await wallet(issuer).deployContract({ abi: compiled.abi, bytecode: compiled.bytecode, args });
    return (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const rejectAddress = await deployFixture("RejectReceiver");
  await expectRevert(() => send(buyer, "withdraw", [1n, rejectAddress]));
  eq(await read("credit", [buyer.address]), 130n);
  const reentrantAddress = await deployFixture("ReentrantReceiver", [contract]);
  const q4 = { ...await quote(), executorPayee: reentrantAddress };
  await send(buyer, "fund", [q4, await signed(q4)], 130n);
  const r4 = await receiptFor(q4, 1); await send(buyer, "settle", [r4, await signReceipt(r4)]);
  const receiverAbi = artifact.testFixtures.ReentrantReceiver.abi;
  const attack = await wallet(issuer).writeContract({ address: reentrantAddress, abi: receiverAbi, functionName: "trigger" });
  eq((await publicClient.waitForTransactionReceipt({ hash: attack })).status, "success");
  eq(await read("credit", [reentrantAddress]), 4n);
  eq(await publicClient.readContract({ address: reentrantAddress, abi: receiverAbi, functionName: "attempted" }), true);
  eq(await publicClient.readContract({ address: reentrantAddress, abi: receiverAbi, functionName: "reentered" }), false);
  eq(await publicClient.getBalance({ address: contract }), await read("totalCredit"));
  console.log(JSON.stringify({ schemaVersion: "settlement-check/v1", network: "local-anvil-monad", hardfork: "MonadTen",
    anvilVersion: match.slice(1).join("."), compiler: artifact.compiler, evmVersion: artifact.evmVersion,
    codeSha256: Object.fromEntries(["contracts/AttemptSettlement.sol", "contracts/test/WithdrawalReceivers.sol", "src/attempt.mjs", "scripts/compile-settlement.mjs", "scripts/settlement-check.mjs"].map(path => [path, digest(readFileSync(new URL(`../${path}`, import.meta.url)))])),
    checksPassed: checks, observedAt: Math.floor(Date.now() / 1000),
    verified: ["JS/Solidity typed digest agreement", "Issuer, buyer and evaluator authority", "Wrong-chain and modified terms rejected", "Exact funding and reserve caps", "Success/failure allocation", "Full timeout refund", "Duplicate funding/settlement/refund rejected", "Owner credit withdrawal and solvency", "Failed transfer restores credit", "Reentrant withdrawal blocked while remaining credit exists"],
    limitations: ["Isolated local Monad execution, not a testnet deployment", "Illustrative amounts, no commercial tariffs", "Evaluator correctness and company approval are trusted", "Automatic withdrawal bar and ERC-20 support not implemented"] }, null, 2));
} finally {
  if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
}
