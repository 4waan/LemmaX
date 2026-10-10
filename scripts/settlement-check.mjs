import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseError, ContractFunctionRevertedError, createWalletClient, erc20Abi, getAddress, hashTypedData, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { compileSettlement } from "./compile-settlement.mjs";
import { deploySettlement, planDeployment } from "./deploy-settlement.mjs";
import { attemptFixture } from "../test/fixtures/attempt.mjs";
import { quoteDigest, quoteTypedData, receiptTypedData, newAttemptId, allocateReceipt, commitAttemptRecord, bindRecordToQuote } from "../src/attempt.mjs";
import { connectMonad, waitForStage, VERIFIED_LAG_BLOCKS } from "../src/monad.mjs";
import { SETTLEMENT_ABI, SettlementRejected, createSettlementClient, quoteArgs, receiptArgs } from "../src/settlement.mjs";
import { readSettlementLogs, reconcileAttempts } from "../src/reconcile.mjs";
import { digest } from "../src/retrieval.mjs";

export const HEADROOM_BPS = 1000;
export const CHECKED_SOURCES = ["contracts/AttemptSettlement.sol", "contracts/AttemptSettlement.abi.json", "contracts/test/MockFiatToken.sol", "src/attempt.mjs",
  "src/monad.mjs", "src/settlement.mjs", "src/reconcile.mjs", "scripts/compile-settlement.mjs", "scripts/deploy-settlement.mjs", "scripts/settlement-check.mjs"];
export const sourceHashes = paths => Object.fromEntries(paths.map(path => [path, digest(readFileSync(new URL(`../${path}`, import.meta.url)))]));

// One-slot epochs give a short finalized lag (latest minus two), standing in for Monad's commitment stages.
export async function startAnvil(extraArgs = []) {
  const binary = process.env.LEMMAX_ANVIL_BIN ?? "anvil";
  const version = execFileSync(binary, ["--version"], { encoding: "utf8" });
  const match = /Version:\s*(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match || Number(match[1]) < 1 || (Number(match[1]) === 1 && Number(match[2]) < 8)) throw new Error("Use official Anvil v1.8 or newer for Monad execution tests");
  const listener = createServer();
  listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const child = spawn(binary, ["--network", "monad", "--hardfork", "MonadTen", "--host", "127.0.0.1", "--port", String(port),
    "--accounts", "0", "--slots-in-an-epoch", "1", "--silent", ...extraArgs], { stdio: ["ignore", "ignore", "pipe"] });
  let nodeError = ""; child.stderr.on("data", data => { nodeError = (nodeError + data).slice(-4096); });
  return { rpc: `http://127.0.0.1:${port}`, version: match.slice(1).join("."), child,
    exited: () => child.exitCode !== null && `Local test node exited: ${nodeError}`,
    async stop() { if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } } };
}
export async function connectWhenReady(node, network) {
  for (let i = 0; i < 300; i++) {
    if (node.exited()) throw new Error(node.exited());
    try { return await connectMonad({ network, rpcUrl: node.rpc, pollingInterval: 25 }); } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error("Local Monad test node did not start");
}

// Runs the full attempt lifecycle against a deployed settlement contract and a USDC-like
// token. `token.mint` supplies buyer funds; `token.extras` adds token-specific checks.
export async function runLifecycle({ chain, publicClient, rpc, artifact, token }) {
  let checks = 0;
  const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
  const gas = {};
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
  const [connector, executor, deployer] = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
  // Buyer holds USDC only; the issuer relays funding and the evaluator relays settlement, both paying MON gas.
  for (const account of [issuer, evaluator, connector, executor, deployer]) await publicClient.request({ method: "anvil_setBalance", params: [account.address, "0x3635c9adc5dea00000"] });
  await token.mint(buyer.address, 10000000n);
  const wallet = account => createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) });
  const balanceOf = owner => publicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

  const plan = await planDeployment({ publicClient, from: deployer.address, artifact, issuer: issuer.address, asset: token.address, gasHeadroomBps: HEADROOM_BPS });
  eq(plan.maxCharge, plan.gasLimit * plan.maxFeePerGas);
  const deployment = await whileMining(deploySettlement({ publicClient, wallet: wallet(deployer), artifact, issuer: issuer.address, asset: token.address,
    gasHeadroomBps: HEADROOM_BPS, stage: "verified", pollMs: 20, timeoutMs: 30000 }));
  eq(BigInt(deployment.confirmation.finalizedHead) >= BigInt(deployment.blockNumber) + VERIFIED_LAG_BLOCKS, true);
  eq([deployment.approvedIssuer, deployment.asset.address, deployment.asset.decimals], [issuer.address, getAddress(token.address), 6]);
  gas.deploy = { gasUsed: deployment.gasUsed, gasLimit: deployment.gasLimit };
  const contract = deployment.address;
  const settlement = createSettlementClient({ publicClient, address: contract, gasHeadroomBps: HEADROOM_BPS });
  eq(await settlement.approvedIssuer(), issuer.address);
  const domain = { chainId: String(chain.id), verifyingContract: contract };
  const read = (name, args = []) => publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName: name, args });
  const record = (name, result) => { gas[name] ??= { gasUsed: result.gasUsed.toString(), gasLimit: result.gasLimit.toString() }; return result; };
  // Expected rejection, checked by estimation so no rejected transaction is mined.
  async function rejected(reason, action) {
    try { await action(); } catch (error) {
      if (error instanceof SettlementRejected) { assert.match(error.reason, reason instanceof RegExp ? reason : new RegExp(`^${reason}$`)); checks++; return; }
      const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : null;
      assert.match(revert?.reason ?? revert?.data?.errorName ?? "", reason instanceof RegExp ? reason : new RegExp(`^${reason}$`)); checks++; return;
    }
    assert.fail(`Expected ${reason}`);
  }
  const quotes = [];
  const quote = async (changes = {}) => {
    const now = (await publicClient.getBlock()).timestamp;
    const r = { ...fixture.record, executeBy: String(now + 120n) }; const salt = newAttemptId();
    const q = { ...fixture.quote, attemptId: newAttemptId(), recordCommitment: commitAttemptRecord(r, salt), asset: getAddress(token.address),
      connectorPayee: connector.address, executorPayee: executor.address, quoteExpiresAt: String(now + 60n), executeBy: String(now + 120n), settleBy: String(now + 180n), ...changes };
    bindRecordToQuote(r, salt, q); return q;
  };
  const signed = q => issuer.signTypedData(quoteTypedData(domain, q));
  // The token rejects an authorization at validBefore, so the buyer's window ends one second after the quote.
  const authorize = async (q, window = {}) => {
    const terms = { validAfter: "0", validBefore: String(BigInt(q.quoteExpiresAt) + 1n), ...window };
    return { ...terms, signature: await buyer.signTypedData(await settlement.fundingAuthorization({ domain, quote: q, ...terms })) };
  };
  const receiptFor = async (q, outcome) => {
    const now = (await publicClient.getBlock()).timestamp.toString();
    return { ...fixture.receipt, attemptId: q.attemptId, quoteDigest: quoteDigest(domain, q), outcome, completedAt: now, evaluatedAt: now };
  };
  const signReceipt = r => evaluator.signTypedData(receiptTypedData(domain, r));
  const fund = async q => {
    const result = await settlement.fund({ wallet: wallet(issuer), quote: q, issuerSignature: await signed(q), authorization: await authorize(q) });
    quotes.push({ quote: q }); return result;
  };
  const settle = async (q, r, account = evaluator) => {
    const result = await settlement.settle({ wallet: wallet(account), quote: q, receipt: r, signature: await signReceipt(r) });
    quotes.find(entry => entry.quote.attemptId === q.attemptId).receipt = r; return result;
  };

  const q1 = await quote(); const sig1 = await signed(q1); const auth1 = await authorize(q1);
  eq(await read("quoteDigest", [quoteArgs(q1)]), quoteDigest(domain, q1));
  const relay = (q, issuerSignature, authorization) => settlement.fund({ wallet: wallet(issuer), quote: q, issuerSignature, authorization });
  await rejected("InvalidAuthority", async () => relay(q1, await buyer.signTypedData(quoteTypedData(domain, q1)), auth1));
  await rejected("InvalidAuthority", () => relay({ ...q1, principal: "101" }, sig1, auth1));
  await rejected("InvalidAuthority", async () => relay(q1, await issuer.signTypedData(quoteTypedData({ ...domain, chainId: "31338" }, q1)), auth1));
  const otherAsset = { ...q1, asset: deployer.address };
  await rejected("InvalidQuote", async () => relay(otherAsset, await signed(otherAsset), auth1));
  const q1b = await quote();
  await rejected(/invalid signature/, async () => relay(q1, sig1, { ...auth1, signature: (await authorize(q1b)).signature }));
  await rejected(/expired/, async () => relay(q1, sig1, await authorize(q1, { validBefore: "1" })));
  const buyerBefore = await balanceOf(buyer.address);
  const funded = record("fund", await fund(q1));
  eq([buyerBefore - await balanceOf(buyer.address), await balanceOf(contract)], [130n, 130n]);
  eq(funded.gasLimit >= funded.gasUsed, true);
  const finalized = await whileMining(waitForStage(publicClient, funded, "finalized", { pollMs: 20, timeoutMs: 30000 }));
  eq(finalized.finalizedHead >= funded.blockNumber, true);
  await rejected("InvalidState", () => relay(q1, sig1, auth1));
  eq(await read("lockedFunds"), 130n);
  eq((await settlement.attemptInfo(q1.attemptId)).state, "funded");
  eq((await settlement.attemptInfo(q1.attemptId)).quoteDigest, quoteDigest(domain, q1));
  const r1 = await receiptFor(q1, 1);
  eq(await read("receiptDigest", [receiptArgs(r1)]), hashTypedData(receiptTypedData(domain, r1)));
  await rejected("InvalidAuthority", async () => settlement.settle({ wallet: wallet(evaluator), quote: q1, receipt: r1, signature: await issuer.signTypedData(receiptTypedData(domain, r1)) }));
  for (const change of [{ executionUsed: "21" }, { evaluationUsed: "11" }, { outcome: 3 }, { quoteDigest: newAttemptId() }, { completedAt: "0" }]) {
    const bad = { ...r1, ...change };
    await rejected("InvalidReceipt", async () => settlement.settle({ wallet: wallet(evaluator), quote: q1, receipt: bad, signature: await signReceipt(bad) }));
  }
  // Settlement must resupply the funded quote exactly; swapped payees fail the stored digest.
  await rejected("InvalidQuote", async () => settlement.settle({ wallet: wallet(evaluator), quote: { ...q1, executorPayee: deployer.address }, receipt: r1, signature: await signReceipt(r1) }));
  await rejected("NotExpired", () => settlement.refundTimeout({ wallet: wallet(buyer), quote: q1 }));
  const receiptSignature = await signReceipt(r1);
  record("settleSuccess", await settle(q1, r1));
  eq(await settlement.attemptState(q1.attemptId), "settled_success");
  const allocation = allocateReceipt({ domain, quote: q1, receipt: r1 });
  for (const [owner, key] of [[connector, "connector"], [executor, "executor"], [evaluator, "evaluator"], [buyer, "buyerCredit"]]) eq(await settlement.credit(owner.address), allocation[key]);
  eq(await read("totalCredit"), 130n); eq(await read("lockedFunds"), 0n);
  await rejected("InvalidState", () => settlement.settle({ wallet: wallet(evaluator), quote: q1, receipt: r1, signature: receiptSignature }));
  await rejected("InvalidState", () => settlement.refundTimeout({ wallet: wallet(executor), quote: q1 }));

  const q2 = await quote(); await fund(q2);
  const r2 = await receiptFor(q2, 2); record("settleFailure", await settle(q2, r2));
  eq(await settlement.attemptState(q2.attemptId), "settled_failure");
  eq(await settlement.credit(buyer.address), "140"); eq(await settlement.credit(connector.address), "100");
  eq(await settlement.credit(executor.address), "14"); eq(await settlement.credit(evaluator.address), "6");
  await publicClient.request({ method: "anvil_setBalance", params: [buyer.address, "0x3635c9adc5dea00000"] });
  const beforeBalance = await balanceOf(connector.address);
  record("withdraw", await settlement.withdraw({ wallet: wallet(buyer), amount: "140", destination: connector.address }));
  eq(await balanceOf(connector.address), beforeBalance + 140n);
  eq(await settlement.credit(buyer.address), "0");
  await rejected("InvalidWithdrawal", () => settlement.withdraw({ wallet: wallet(buyer), amount: "1", destination: buyer.address }));
  await rejected("InvalidWithdrawal", () => settlement.withdraw({ wallet: wallet(connector), amount: "1", destination: contract }));

  const q3 = await quote(); await fund(q3);
  await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(q3.settleBy) + 1] });
  await mine();
  const late = { ...await receiptFor(q3, 1), completedAt: q3.executeBy, evaluatedAt: q3.executeBy };
  await rejected("InvalidReceipt", async () => settlement.settle({ wallet: wallet(evaluator), quote: q3, receipt: late, signature: await signReceipt(late) }));
  record("refundTimeout", await settlement.refundTimeout({ wallet: wallet(executor), quote: q3 }));
  eq(await settlement.attemptState(q3.attemptId), "refunded_timeout"); eq(await settlement.credit(buyer.address), "130");
  eq(await read("lockedFunds"), 0n);
  await rejected("InvalidState", () => settlement.refundTimeout({ wallet: wallet(buyer), quote: q3 }));
  if (token.extras) checks += await token.extras({ settlement, wallet, rejected, eq, buyer, connector, contract, quote, signed, authorize, relay });
  const q4 = await quote(); await fund(q4);
  const r4 = await receiptFor(q4, 1); await settle(q4, r4);
  const q5 = await quote(); await fund(q5);

  const ledger = await settlement.ledger();
  eq(ledger.solvent, true);
  eq(BigInt(ledger.balance), BigInt(ledger.lockedFunds) + BigInt(ledger.totalCredit) + BigInt(ledger.unallocated));
  const latest = await publicClient.getBlockNumber();
  const logs = await readSettlementLogs({ publicClient, address: contract, fromBlock: BigInt(deployment.blockNumber), toBlock: latest, maxBlockRange: 7n });
  const onchainStates = Object.fromEntries(await Promise.all(quotes.map(async ({ quote: q }) => [q.attemptId, await settlement.attemptState(q.attemptId)])));
  const reconciliation = reconcileAttempts({ logs: [...logs, ...logs.slice(0, 3)], domain, attempts: quotes, onchainStates, ledger });
  eq(reconciliation.ok, true);
  eq(reconciliation.attempts.map(a => a.state), ["settled_success", "settled_failure", "refunded_timeout", "settled_success", "funded"]);
  eq(reconciliation.expectedLocked, ledger.lockedFunds);
  eq(reconciliation.attempts[0].allocation, allocation);
  eq(reconciliation.withdrawals[buyer.address], "140");
  const tampered = reconcileAttempts({ logs, domain, attempts: quotes.map(entry => entry.quote.attemptId === q1.attemptId ? { ...entry, receipt: { ...r1, evaluationUsed: "9" } } : entry), onchainStates, ledger });
  eq(tampered.attempts[0].issues, ["receipt_mismatch"]);
  return { checks, gas, deployment, ledger, issuer, wallet };
}

async function main() {
  const node = await startAnvil(["--chain-id", "31337"]);
  try {
    const { chain, publicClient } = await connectWhenReady(node, "local");
    const artifact = compileSettlement(true);
    const mock = artifact.testFixtures.MockFiatToken;
    const funder = privateKeyToAccount(generatePrivateKey());
    await publicClient.request({ method: "anvil_setBalance", params: [funder.address, "0x3635c9adc5dea00000"] });
    const funderWallet = createWalletClient({ account: funder, chain, transport: http(node.rpc, { retryCount: 0 }) });
    const deployedToken = await publicClient.waitForTransactionReceipt({ hash: await funderWallet.deployContract({ abi: mock.abi, bytecode: mock.bytecode }) });
    const tokenAddress = deployedToken.contractAddress;
    const tokenCall = async (functionName, args) => publicClient.waitForTransactionReceipt({ hash: await funderWallet.writeContract({ address: tokenAddress, abi: mock.abi, functionName, args }) });
    const token = { address: tokenAddress, mint: (to, amount) => tokenCall("mint", [to, amount]),
      // Mock-only behaviour: a blocked destination and a short-paying token.
      async extras({ settlement, wallet, rejected, eq, connector, contract, quote, signed, authorize, relay }) {
        await tokenCall("blacklist", [connector.address, true]);
        await rejected(/blacklisted/, () => settlement.withdraw({ wallet: wallet(connector), amount: "1", destination: connector.address }));
        eq(await settlement.credit(connector.address), "100");
        await tokenCall("blacklist", [connector.address, false]);
        await tokenCall("setShortfall", [1n]);
        const short = await quote();
        await rejected("InvalidQuote", async () => relay(short, await signed(short), await authorize(short)));
        await tokenCall("setShortfall", [0n]);
        await tokenCall("mint", [contract, 7n]);
        eq((await settlement.ledger()).unallocated, "7");
        return 0;
      } };
    const result = await runLifecycle({ chain, publicClient, rpc: node.rpc, artifact, token });
    let checks = result.checks;
    const eq = (a, b) => { assert.deepEqual(a, b); checks++; };

    const cliEnv = { PATH: process.env.PATH, LEMMAX_MONAD_NETWORK: "local", LEMMAX_MONAD_RPC_URL: node.rpc, LEMMAX_QUOTE_ISSUER: result.issuer.address,
      LEMMAX_SETTLEMENT_ASSET: tokenAddress, LEMMAX_GAS_HEADROOM_BPS: String(HEADROOM_BPS) };
    const script = fileURLToPath(new URL("./deploy-settlement.mjs", import.meta.url));
    const dryRun = JSON.parse(execFileSync(process.execPath, [script], { env: cliEnv, encoding: "utf8" }));
    eq([dryRun.dryRun, dryRun.chainId, dryRun.asset.decimals], [true, 31337, 6]);
    const output = mkdtempSync(join(tmpdir(), "lemmax-deploy-"));
    try {
      const cliKey = generatePrivateKey();
      await publicClient.request({ method: "anvil_setBalance", params: [privateKeyToAccount(cliKey).address, "0x3635c9adc5dea00000"] });
      const broadcast = JSON.parse(execFileSync(process.execPath, [script], { encoding: "utf8", env: { ...cliEnv, LEMMAX_DEPLOY_BROADCAST: "1",
        LEMMAX_DEPLOYER_KEY: cliKey, LEMMAX_CONFIRMATION_STAGE: "included", LEMMAX_DEPLOYMENT_OUTPUT: output } }));
      eq(JSON.stringify(broadcast).includes(cliKey.slice(2)), false);
      const written = JSON.parse(readFileSync(join(output, "AttemptSettlement.local.json"), "utf8"));
      eq([broadcast.dryRun, written.address, written.maskedRuntimeSha256, written.asset.address], [false, broadcast.address, result.deployment.maskedRuntimeSha256, getAddress(tokenAddress)]);
      eq(Object.keys(JSON.parse(readFileSync(join(output, "AttemptSettlement.standard-input.json"), "utf8")).sources).length > 1, true);
    } finally { rmSync(output, { recursive: true, force: true }); }

    console.log(JSON.stringify({ schemaVersion: "settlement-check/v3", network: "local-anvil-monad", hardfork: "MonadTen", asset: "MockFiatToken (EIP-3009, six decimals)",
      anvilVersion: node.version, compiler: artifact.compiler, evmVersion: artifact.evmVersion, deployedBytecodeBytes: artifact.deployedBytecodeBytes,
      codeSha256: sourceHashes(CHECKED_SOURCES), checksPassed: checks, observedAt: Math.floor(Date.now() / 1000), gasHeadroomBps: HEADROOM_BPS, gas: result.gas,
      verified: ["Dry-run plan and broadcast deployment through the operator script", "Deployed runtime matches the build with immutables masked", "Deployment and funding waits for verified and finalized stages",
        "JS/Solidity typed digest agreement", "Issuer, buyer and evaluator authority with named errors", "Buyer EIP-3009 authorization bound to the quote digest, relayed by another wallet",
        "Wrong-chain, modified terms, foreign asset, expired or mismatched buyer authorization rejected", "Settlement requires the funded quote; swapped payees rejected", "Exact funding and reserve caps",
        "Success/failure allocation", "Full timeout refund", "Duplicate funding/settlement/refund rejected", "Owner credit withdrawal; withdrawal to the contract rejected",
        "Blocked destination reverts and keeps credit", "Short-paying token rejected", "Tokens sent directly stay unallocated", "Chunked event reads reconcile with private quotes and receipts",
        "Duplicate log delivery is idempotent", "Tampered private receipt is reported"],
      limitations: ["Isolated local Monad execution with a mock token, not a testnet deployment", "Local finalized lag comes from one-slot epochs, not Monad consensus",
        "Illustrative atomic amounts, not the demonstration tariff", "Evaluator correctness and company approval are trusted", "Smart-contract buyer signatures not exercised", "Automatic withdrawal bar not implemented"] }, null, 2));
  } finally { await node.stop(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
