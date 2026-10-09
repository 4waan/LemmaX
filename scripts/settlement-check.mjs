import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BaseError, ContractFunctionRevertedError, createWalletClient, getAddress, hashTypedData, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileSettlement } from "./compile-settlement.mjs";
import { deploySettlement, planDeployment } from "./deploy-settlement.mjs";
import { attemptFixture } from "../test/fixtures/attempt.mjs";
import { quoteDigest, quoteTypedData, receiptTypedData, newAttemptId, allocateReceipt, commitAttemptRecord, bindRecordToQuote } from "../src/attempt.mjs";
import { RESERVE_BALANCE_WEI, connectMonad, waitForStage, VERIFIED_LAG_BLOCKS } from "../src/monad.mjs";
import { SETTLEMENT_ABI, SettlementRejected, createSettlementClient, quoteArgs, receiptArgs } from "../src/settlement.mjs";
import { readSettlementLogs, reconcileAttempts } from "../src/reconcile.mjs";
import { digest } from "../src/retrieval.mjs";

const binary = process.env.LEMMAX_ANVIL_BIN ?? "anvil";
const version = execFileSync(binary, ["--version"], { encoding: "utf8" });
const match = /Version:\s*(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 8)) throw new Error("Use official Anvil v1.8 or newer for Monad execution tests");
const artifact = compileSettlement(true);
const listener = createServer();
listener.listen(0, "127.0.0.1"); await once(listener, "listening");
const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
// One-slot epochs give a short finalized lag (latest minus two), standing in for Monad's commitment stages.
const child = spawn(binary, ["--network", "monad", "--hardfork", "MonadTen", "--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337",
  "--accounts", "0", "--slots-in-an-epoch", "1", "--silent"], { stdio: ["ignore", "ignore", "pipe"] });
let nodeError = ""; child.stderr.on("data", data => { nodeError = (nodeError + data).slice(-4096); });
const rpc = `http://127.0.0.1:${port}`;
const HEADROOM_BPS = 1000;
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const gas = {};
try {
  let connection;
  for (let i = 0; i < 100 && !connection; i++) {
    if (child.exitCode !== null) throw new Error(`Local test node exited: ${nodeError}`);
    try { connection = await connectMonad({ network: "local", rpcUrl: rpc, pollingInterval: 25 }); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  if (!connection) throw new Error("Local Monad test node did not start");
  const { chain, publicClient } = connection;
  const mine = () => publicClient.request({ method: "evm_mine", params: [] });
  // Advance blocks while a confirmation wait is pending; local blocks are otherwise mined only on transactions.
  async function whileMining(promise) {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    while (!done) { await mine(); await new Promise(resolve => setTimeout(resolve, 10)); }
    return promise;
  }
  const fixture = attemptFixture();
  const issuer = fixture.issuer, buyer = fixture.buyer, evaluator = fixture.evaluator;
  const connector = privateKeyToAccount(generatePrivateKey()), executor = privateKeyToAccount(generatePrivateKey()), deployer = privateKeyToAccount(generatePrivateKey());
  for (const account of [issuer, buyer, evaluator, connector, executor, deployer]) await publicClient.request({ method: "anvil_setBalance", params: [account.address, "0x3635c9adc5dea00000"] });
  const wallet = account => createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) });

  const plan = await planDeployment({ publicClient, from: deployer.address, artifact, issuer: issuer.address, gasHeadroomBps: HEADROOM_BPS });
  eq(plan.maxCharge, plan.gasLimit * plan.maxFeePerGas);
  const deployment = await whileMining(deploySettlement({ publicClient, wallet: wallet(deployer), artifact, issuer: issuer.address,
    gasHeadroomBps: HEADROOM_BPS, stage: "verified", pollMs: 20, timeoutMs: 30000 }));
  eq(BigInt(deployment.confirmation.finalizedHead) >= BigInt(deployment.blockNumber) + VERIFIED_LAG_BLOCKS, true);
  eq(deployment.approvedIssuer, issuer.address);
  gas.deploy = { gasUsed: deployment.gasUsed, gasLimit: deployment.gasLimit };
  const contract = deployment.address;
  const settlement = createSettlementClient({ publicClient, address: contract, gasHeadroomBps: HEADROOM_BPS });
  eq(await settlement.approvedIssuer(), issuer.address);
  const domain = { chainId: "31337", verifyingContract: contract };
  const read = (name, args = []) => publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName: name, args });
  const record = (name, result) => { gas[name] ??= { gasUsed: result.gasUsed.toString(), gasLimit: result.gasLimit.toString() }; return result; };
  // Expected custom error, checked by estimation so no rejected transaction is mined.
  async function rejected(reason, action) {
    try { await action(); } catch (error) {
      if (error instanceof SettlementRejected) { eq(error.reason, reason); return; }
      const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : null;
      eq(revert?.data?.errorName, reason); return;
    }
    assert.fail(`Expected ${reason}`);
  }
  const estimate = (account, functionName, args, value = 0n) => publicClient.estimateContractGas({ address: contract, abi: SETTLEMENT_ABI, functionName, args, value, account });
  const quotes = [];
  const quote = async () => {
    const now = (await publicClient.getBlock()).timestamp;
    const r = { ...fixture.record, executeBy: String(now + 120n) }; const salt = newAttemptId();
    const q = { ...fixture.quote, attemptId: newAttemptId(), recordCommitment: commitAttemptRecord(r, salt), connectorPayee: connector.address, executorPayee: executor.address,
      quoteExpiresAt: String(now + 60n), executeBy: String(now + 120n), settleBy: String(now + 180n) };
    bindRecordToQuote(r, salt, q); return q;
  };
  const signed = q => issuer.signTypedData(quoteTypedData(domain, q));
  const receiptFor = async (q, outcome) => {
    const now = (await publicClient.getBlock()).timestamp.toString();
    return { ...fixture.receipt, attemptId: q.attemptId, quoteDigest: quoteDigest(domain, q), outcome, completedAt: now, evaluatedAt: now };
  };
  const signReceipt = r => evaluator.signTypedData(receiptTypedData(domain, r));
  const fund = async q => { const result = await settlement.fund({ wallet: wallet(buyer), quote: q, signature: await signed(q) }); quotes.push({ quote: q }); return result; };
  const settle = async (r, account = buyer) => {
    const result = await settlement.settle({ wallet: wallet(account), receipt: r, signature: await signReceipt(r) });
    quotes.find(entry => entry.quote.attemptId === r.attemptId).receipt = r; return result;
  };

  const q1 = await quote(); const sig1 = await signed(q1);
  eq(await read("quoteDigest", [quoteArgs(q1)]), quoteDigest(domain, q1));
  await rejected("InvalidAuthority", () => settlement.fund({ wallet: wallet(issuer), quote: q1, signature: sig1 }));
  await rejected("InvalidQuote", () => estimate(buyer, "fund", [quoteArgs(q1), sig1], 129n));
  await rejected("InvalidAuthority", () => settlement.fund({ wallet: wallet(buyer), quote: { ...q1, principal: "101" }, signature: sig1 }));
  const crossChain = await issuer.signTypedData(quoteTypedData({ ...domain, chainId: "31338" }, q1));
  await rejected("InvalidAuthority", () => settlement.fund({ wallet: wallet(buyer), quote: q1, signature: crossChain }));
  const thin = privateKeyToAccount(generatePrivateKey());
  await publicClient.request({ method: "anvil_setBalance", params: [thin.address, `0x${(RESERVE_BALANCE_WEI + 129n).toString(16)}`] });
  await rejected("reserve_balance_risk", () => settlement.fund({ wallet: wallet(thin), quote: { ...q1, buyer: thin.address }, signature: sig1 }));
  const funded = record("fund", await fund(q1));
  eq(funded.gasLimit >= funded.gasUsed, true);
  const finalized = await whileMining(waitForStage(publicClient, funded, "finalized", { pollMs: 20, timeoutMs: 30000 }));
  eq(finalized.finalizedHead >= funded.blockNumber, true);
  await rejected("InvalidState", () => settlement.fund({ wallet: wallet(buyer), quote: q1, signature: sig1 }));
  eq(await read("lockedFunds"), 130n);
  eq(await settlement.attemptState(q1.attemptId), "funded");
  const r1 = await receiptFor(q1, 1);
  eq(await read("receiptDigest", [receiptArgs(r1)]), hashTypedData(receiptTypedData(domain, r1)));
  await rejected("InvalidAuthority", async () => settlement.settle({ wallet: wallet(buyer), receipt: r1, signature: await issuer.signTypedData(receiptTypedData(domain, r1)) }));
  for (const change of [{ executionUsed: "21" }, { evaluationUsed: "11" }, { outcome: 3 }, { quoteDigest: newAttemptId() }, { completedAt: "0" }]) {
    const bad = { ...r1, ...change };
    await rejected("InvalidReceipt", async () => settlement.settle({ wallet: wallet(buyer), receipt: bad, signature: await signReceipt(bad) }));
  }
  await rejected("NotExpired", () => settlement.refundTimeout({ wallet: wallet(buyer), attemptId: q1.attemptId }));
  const receiptSignature = await signReceipt(r1);
  // Any caller can relay a valid evaluator receipt; recipients stay frozen by the funded quote.
  record("settleSuccess", await settle(r1, executor));
  eq(await settlement.attemptState(q1.attemptId), "settled_success");
  const allocation = allocateReceipt({ domain, quote: q1, receipt: r1 });
  for (const [owner, key] of [[connector, "connector"], [executor, "executor"], [evaluator, "evaluator"], [buyer, "buyerCredit"]]) eq(await settlement.credit(owner.address), allocation[key]);
  eq(await read("totalCredit"), 130n); eq(await read("lockedFunds"), 0n);
  await rejected("InvalidState", () => settlement.settle({ wallet: wallet(buyer), receipt: r1, signature: receiptSignature }));
  await rejected("InvalidState", () => settlement.refundTimeout({ wallet: wallet(buyer), attemptId: q1.attemptId }));

  const q2 = await quote(); await fund(q2);
  const r2 = await receiptFor(q2, 2); record("settleFailure", await settle(r2));
  eq(await settlement.attemptState(q2.attemptId), "settled_failure");
  eq(await settlement.credit(buyer.address), "140"); eq(await settlement.credit(connector.address), "100");
  eq(await settlement.credit(executor.address), "14"); eq(await settlement.credit(evaluator.address), "6");
  const beforeBalance = await publicClient.getBalance({ address: connector.address });
  record("withdraw", await settlement.withdraw({ wallet: wallet(buyer), amount: "140", destination: connector.address }));
  eq(await publicClient.getBalance({ address: connector.address }), beforeBalance + 140n);
  eq(await settlement.credit(buyer.address), "0");
  await rejected("InvalidWithdrawal", () => settlement.withdraw({ wallet: wallet(buyer), amount: "1", destination: buyer.address }));

  const q3 = await quote(); await fund(q3);
  await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(q3.settleBy) + 1] });
  await mine();
  const late = { ...await receiptFor(q3, 1), completedAt: q3.executeBy, evaluatedAt: q3.executeBy };
  await rejected("InvalidReceipt", async () => settlement.settle({ wallet: wallet(buyer), receipt: late, signature: await signReceipt(late) }));
  record("refundTimeout", await settlement.refundTimeout({ wallet: wallet(executor), attemptId: q3.attemptId }));
  eq(await settlement.attemptState(q3.attemptId), "refunded_timeout"); eq(await settlement.credit(buyer.address), "130");
  eq(await read("lockedFunds"), 0n);
  await rejected("InvalidState", () => settlement.refundTimeout({ wallet: wallet(buyer), attemptId: q3.attemptId }));
  const deployFixture = async (name, args = []) => {
    const compiled = artifact.testFixtures[name];
    const hash = await wallet(issuer).deployContract({ abi: compiled.abi, bytecode: compiled.bytecode, args });
    return (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const rejectAddress = await deployFixture("RejectReceiver");
  await rejected("InvalidWithdrawal", () => settlement.withdraw({ wallet: wallet(buyer), amount: "1", destination: rejectAddress }));
  eq(await settlement.credit(buyer.address), "130");
  const reentrantAddress = await deployFixture("ReentrantReceiver", [contract]);
  const q4 = { ...await quote(), executorPayee: reentrantAddress };
  await fund(q4);
  const r4 = await receiptFor(q4, 1); await settle(r4);
  const receiverAbi = artifact.testFixtures.ReentrantReceiver.abi;
  const attack = await wallet(issuer).writeContract({ address: reentrantAddress, abi: receiverAbi, functionName: "trigger" });
  eq((await publicClient.waitForTransactionReceipt({ hash: attack })).status, "success");
  eq(await settlement.credit(reentrantAddress), "4");
  eq(await publicClient.readContract({ address: reentrantAddress, abi: receiverAbi, functionName: "attempted" }), true);
  eq(await publicClient.readContract({ address: reentrantAddress, abi: receiverAbi, functionName: "reentered" }), false);
  const q5 = await quote(); await fund(q5);

  const ledger = await settlement.ledger();
  eq(ledger.solvent, true); eq(ledger.unallocated, "0");
  eq(BigInt(ledger.balance), BigInt(ledger.lockedFunds) + BigInt(ledger.totalCredit));
  const latest = await publicClient.getBlockNumber();
  const logs = await readSettlementLogs({ publicClient, address: contract, fromBlock: BigInt(deployment.blockNumber), toBlock: latest, maxBlockRange: 7n });
  const onchainStates = Object.fromEntries(await Promise.all(quotes.map(async ({ quote: q }) => [q.attemptId, await settlement.attemptState(q.attemptId)])));
  const reconciliation = reconcileAttempts({ logs: [...logs, ...logs.slice(0, 3)], domain, attempts: quotes, onchainStates, ledger });
  eq(reconciliation.ok, true);
  eq(reconciliation.attempts.map(a => a.state), ["settled_success", "settled_failure", "refunded_timeout", "settled_success", "funded"]);
  eq(reconciliation.expectedLocked, ledger.lockedFunds);
  eq(reconciliation.attempts[0].allocation, allocation);
  eq(reconciliation.withdrawals, { [buyer.address]: "140", [getAddress(reentrantAddress)]: "3" });
  const tampered = reconcileAttempts({ logs, domain, attempts: quotes.map(entry => entry.quote.attemptId === q1.attemptId ? { ...entry, receipt: { ...r1, evaluationUsed: "9" } } : entry), onchainStates, ledger });
  eq(tampered.attempts[0].issues, ["receipt_mismatch"]);

  const cliEnv = { PATH: process.env.PATH, LEMMAX_MONAD_NETWORK: "local", LEMMAX_MONAD_RPC_URL: rpc, LEMMAX_QUOTE_ISSUER: issuer.address, LEMMAX_GAS_HEADROOM_BPS: String(HEADROOM_BPS) };
  const script = new URL("./deploy-settlement.mjs", import.meta.url).pathname;
  const dryRun = JSON.parse(execFileSync(process.execPath, [script], { env: cliEnv, encoding: "utf8" }));
  eq([dryRun.dryRun, dryRun.chainId, dryRun.gasLimit], [true, 31337, plan.gasLimit.toString()]);
  const output = mkdtempSync(join(tmpdir(), "lemmax-deploy-"));
  try {
    const cliKey = generatePrivateKey();
    await publicClient.request({ method: "anvil_setBalance", params: [privateKeyToAccount(cliKey).address, "0x3635c9adc5dea00000"] });
    const broadcast = JSON.parse(execFileSync(process.execPath, [script], { encoding: "utf8", env: { ...cliEnv, LEMMAX_DEPLOY_BROADCAST: "1",
      LEMMAX_DEPLOYER_KEY: cliKey, LEMMAX_CONFIRMATION_STAGE: "included", LEMMAX_DEPLOYMENT_OUTPUT: output } }));
    eq(JSON.stringify(broadcast).includes(cliKey.slice(2)), false);
    const written = JSON.parse(readFileSync(join(output, "AttemptSettlement.local.json"), "utf8"));
    eq([broadcast.dryRun, written.address, written.maskedRuntimeSha256], [false, broadcast.address, deployment.maskedRuntimeSha256]);
    eq(Object.keys(JSON.parse(readFileSync(join(output, "AttemptSettlement.standard-input.json"), "utf8")).sources).length > 1, true);
  } finally { rmSync(output, { recursive: true, force: true }); }

  console.log(JSON.stringify({ schemaVersion: "settlement-check/v2", network: "local-anvil-monad", hardfork: "MonadTen",
    anvilVersion: match.slice(1).join("."), compiler: artifact.compiler, evmVersion: artifact.evmVersion, deployedBytecodeBytes: artifact.deployedBytecodeBytes,
    codeSha256: Object.fromEntries(["contracts/AttemptSettlement.sol", "contracts/AttemptSettlement.abi.json", "contracts/test/WithdrawalReceivers.sol", "src/attempt.mjs", "src/monad.mjs", "src/settlement.mjs", "src/reconcile.mjs",
      "scripts/compile-settlement.mjs", "scripts/deploy-settlement.mjs", "scripts/settlement-check.mjs"].map(path => [path, digest(readFileSync(new URL(`../${path}`, import.meta.url)))])),
    checksPassed: checks, observedAt: Math.floor(Date.now() / 1000),
    gasHeadroomBps: HEADROOM_BPS, gas,
    verified: ["Dry-run plan and broadcast deployment through the operator script", "Deployed runtime matches the build with immutables masked", "Deployment and funding waits for verified and finalized stages",
      "JS/Solidity typed digest agreement", "Issuer, buyer and evaluator authority with named custom errors", "Wrong-chain and modified terms rejected", "Exact funding and reserve caps",
      "Success/failure allocation", "Full timeout refund", "Duplicate funding/settlement/refund rejected", "Owner credit withdrawal and solvency", "Failed transfer restores credit",
      "Reentrant withdrawal blocked while remaining credit exists", "Funding that would dip into the Monad reserve balance is refused before sending", "Chunked event reads reconcile with private quotes and receipts", "Duplicate log delivery is idempotent", "Tampered private receipt is reported"],
    limitations: ["Isolated local Monad execution, not a testnet deployment", "Local finalized lag comes from one-slot epochs, not Monad consensus", "Illustrative amounts, no commercial tariffs",
      "Evaluator correctness and company approval are trusted", "Automatic withdrawal bar and ERC-20 support not implemented"] }, null, 2));
} finally {
  if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
}
