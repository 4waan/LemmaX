import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWalletClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileSettlement } from "./compile-settlement.mjs";
import { deploySettlement, planDeployment } from "./deploy-settlement.mjs";
import { forkMinter } from "./fork-usdc.mjs";
import { connectWhenReady, sourceHashes, startAnvil } from "./settlement-check.mjs";
import { loadRetrievalReport } from "./verify-retrieval.mjs";
import { MONAD_NETWORKS, connectMonad, waitForStage } from "../src/monad.mjs";
import { createSettlementClient } from "../src/settlement.mjs";
import { readSettlementLogs, reconcileAttempts } from "../src/reconcile.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { createEvaluator } from "../src/evaluator.mjs";
import { createPurchaseDesk, plain } from "../src/purchase.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { createSciFactIndex, loadSciFact } from "../src/scifact.mjs";
import { DEMO_TERMS, formatUsdc, usdcAtomic } from "../src/terms.mjs";

// Runs the agreed three-attempt demonstration (success, eligible failure, timeout) through
// the MCP purchase tools. LEMMAX_DEMO_TARGET=fork rehearses on a local fork of Monad Testnet
// with fork-minted funds. LEMMAX_DEMO_TARGET=testnet is a dry run (balances and budget only)
// unless LEMMAX_DEMO_BROADCAST=1. Keys come from the environment and are never printed.
const HEADROOM_BPS = 1000;
const EXPLORER = "https://testnet.monadvision.com";
const SCENARIO = "demo-terms-llm-reads-corpus/v1", CHECK_SCENARIO = "demo-terms-own-pipeline/v1";
const forkGas = JSON.parse(readFileSync(new URL("../verification/settlement-fork-check.json", import.meta.url), "utf8")).gas;
const limit = name => BigInt(forkGas[name].gasLimit);

function roles(env) {
  const key = name => { try { return privateKeyToAccount(env[name]); } catch { throw new TypeError(`${name} is missing or is not a private key`); } };
  const r = { deployer: key("DEPLOYER_PRIVATE_KEY"), facilitator: key("FACILITATOR_PRIVATE_KEY"), evaluator: key("EVALUATOR_PRIVATE_KEY"), buyer: key("BENCHMARK_BUYER_PRIVATE_KEY") };
  if (env.BENCHMARK_BUYER_ADDRESS && getAddress(env.BENCHMARK_BUYER_ADDRESS) !== r.buyer.address) throw new TypeError("BENCHMARK_BUYER_ADDRESS does not match its key");
  if (r.facilitator.address === r.evaluator.address) throw new TypeError("Issuer and evaluator keys must differ");
  return { ...r, provider: getAddress(env.LEMMA_PROVIDER_ADDRESS ?? ""),
    caps: { maxPerAttempt: usdcAtomic(env.LEMMA_MAX_USDC_PER_RESOLUTION), dailyCap: usdcAtomic(env.LEMMA_DAILY_USDC_CAP) } };
}

async function balances(publicClient, usdc, accounts) {
  return Object.fromEntries(await Promise.all(Object.entries(accounts).map(async ([role, address]) => [role, {
    address, mon: formatUnits(await publicClient.getBalance({ address }), 18),
    usdc: formatUnits(await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }), 6) }])));
}

// Budget from gas limits measured against real USDC on the fork, at the current max fee.
async function budget({ publicClient, usdc, r, plan }) {
  const { maxFeePerGas } = await publicClient.estimateFeesPerGas();
  const need = { deployer: plan ? plan.maxCharge : 0n,
    facilitator: (3n * limit("fund") + limit("withdraw")) * maxFeePerGas,
    evaluator: (limit("settleSuccess") + limit("settleFailure") + limit("refundTimeout")) * maxFeePerGas };
  const usdcNeed = 3n * (BigInt(DEMO_TERMS.principal) + BigInt(DEMO_TERMS.executionCap) + BigInt(DEMO_TERMS.evaluationCap));
  const rows = {};
  for (const role of ["deployer", "facilitator", "evaluator"]) {
    const have = await publicClient.getBalance({ address: r[role].address });
    rows[role] = { address: r[role].address, monNeeded: formatUnits(need[role], 18), monHeld: formatUnits(have, 18), sufficient: have >= need[role] };
  }
  const buyerUsdc = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [r.buyer.address] });
  rows.buyer = { address: r.buyer.address, usdcNeeded: formatUsdc(usdcNeed), usdcHeld: formatUsdc(buyerUsdc), sufficient: buyerUsdc >= usdcNeed };
  return { maxFeePerGas: maxFeePerGas.toString(), roles: rows, sufficient: Object.values(rows).every(row => row.sufficient) };
}

async function main(env) {
  const target = env.LEMMAX_DEMO_TARGET;
  if (!["fork", "testnet"].includes(target)) throw new TypeError("Set LEMMAX_DEMO_TARGET to fork or testnet");
  const r = roles(env);
  const data = loadSciFact(env.LEMMAX_SCIFACT_DIR), index = createSciFactIndex(data), report = loadRetrievalReport();
  const usdc = MONAD_NETWORKS.testnet.usdc;
  let node = null;
  try {
    let connection, rpc;
    if (target === "fork") {
      if (!env.LEMMAX_FORK_RPC_URL) throw new TypeError("Set LEMMAX_FORK_RPC_URL to a Monad Testnet endpoint");
      node = await startAnvil(["--fork-url", env.LEMMAX_FORK_RPC_URL, "--block-time", "1"]);
      connection = await connectWhenReady(node, "testnet"); rpc = node.rpc;
      const minter = await forkMinter({ publicClient: connection.publicClient, chain: connection.chain, rpc, usdc });
      for (const role of ["deployer", "facilitator", "evaluator"]) await minter.setMon(r[role].address, 10n ** 18n);
      await minter.mint(r.buyer.address, 50000n);
    } else {
      rpc = env.LEMMAX_MONAD_RPC_URL;
      connection = await connectMonad({ network: "testnet", rpcUrl: rpc, pollingInterval: 300 });
    }
    const { chain, publicClient } = connection;
    const wallet = account => createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) });
    const artifact = compileSettlement();
    const reuse = env.LEMMAX_SETTLEMENT_ADDRESS ? getAddress(env.LEMMAX_SETTLEMENT_ADDRESS) : null;
    const plan = reuse ? null : await planDeployment({ publicClient, from: r.deployer.address, artifact, issuer: r.facilitator.address, asset: usdc, gasHeadroomBps: HEADROOM_BPS });
    const roleAddresses = { deployer: r.deployer.address, facilitator: r.facilitator.address, evaluator: r.evaluator.address, buyer: r.buyer.address, provider: r.provider };
    const before = await balances(publicClient, usdc, roleAddresses);
    const funding = await budget({ publicClient, usdc, r, plan });
    if (target === "testnet" && (env.LEMMAX_DEMO_BROADCAST !== "1" || !funding.sufficient)) {
      return { schemaVersion: "testnet-demo/v1", target, dryRun: true, chainId: chain.id, settlement: reuse ?? "to be deployed", budget: funding,
        next: funding.sufficient ? "Set LEMMAX_DEMO_BROADCAST=1 to run on Monad Testnet." : "Fund the roles marked insufficient, then rerun." };
    }
    const confirm = result => waitForStage(publicClient, result, "verified", { pollMs: 300, timeoutMs: 180000 });
    let deployment = null, address = reuse;
    if (!reuse) {
      deployment = await deploySettlement({ publicClient, wallet: wallet(r.deployer), artifact, issuer: r.facilitator.address, asset: usdc,
        gasHeadroomBps: HEADROOM_BPS, stage: "verified", pollMs: 300, timeoutMs: 180000 });
      address = deployment.address;
    }
    const settlement = createSettlementClient({ publicClient, address, gasHeadroomBps: HEADROOM_BPS });
    if (await settlement.approvedIssuer() !== r.facilitator.address) throw new TypeError("Settlement contract names a different issuer");
    const token = await settlement.asset();
    if (token.address !== getAddress(usdc)) throw new TypeError("Settlement contract uses a different token");
    const domain = { chainId: String(chain.id), verifyingContract: address };
    const chainTime = async () => (await publicClient.getBlock()).timestamp.toString();
    const issuer = createQuoteIssuer({ account: r.facilitator, domain, token, caps: r.caps,
      payees: { connector: r.provider, executor: r.facilitator.address, evaluator: r.evaluator.address, evaluatorSigner: r.evaluator.address } });
    const evaluator = createEvaluator({ account: r.evaluator, domain, index, data });
    const desk = createPurchaseDesk({ issuer, settlement, relayer: wallet(r.facilitator), data, chainTime, confirm });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(createPublicDirectory({ report, index, data }), desk);
    const agent = new Client({ name: "LemmaX-demo-buyer-agent", version: "0.5.0" });
    await server.connect(serverTransport); await agent.connect(clientTransport);
    const call = async (name, args) => {
      const result = await agent.callTool({ name, arguments: args });
      if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
      return result.structuredContent;
    };
    try {
      // The buyer agent ranks offers under its declared alternative, then buys the top offer.
      const assessments = {};
      for (const scenarioRef of [SCENARIO, CHECK_SCENARIO]) {
        const assessed = await call("lemma_assess", { profileRef: report.profileRef ?? "beir-scifact-test-source-hit5/v1", scenarioRef });
        assessments[scenarioRef] = assessed.results.map(x => ({ offerRef: x.offerRef, pOutcome: x.pOutcome.mean, cReuse: x.cReuse, expectedSaving: x.expectedSaving, rank: x.rank }));
      }
      const offerRef = assessments[SCENARIO].find(x => x.rank === 1).offerRef;
      const outcomes = report.perCase.filter(row => row.outputs[offerRef]);
      const hits = outcomes.filter(row => row.outputs[offerRef].success), misses = outcomes.filter(row => !row.outputs[offerRef].success);
      const plans = [{ label: "timeout", caseRef: hits[1].caseRef, profileRef: "demo-timeout/v1" },
        { label: "success", caseRef: hits[0].caseRef, profileRef: "demo-standard/v1" },
        { label: "eligible_failure", caseRef: misses[0].caseRef, profileRef: "demo-standard/v1" }];
      const attempts = [];
      const step = (attempt, name, result) => { attempt.steps[name] = { transactionHash: result.hash ?? result.transactionHash, gasUsed: String(result.gasUsed), gasLimit: String(result.gasLimit),
        ...(target === "testnet" ? { explorer: `${EXPLORER}/tx/${result.hash ?? result.transactionHash}` } : {}) }; };
      for (const plan of plans) {
        const q = await call("lemma_quote_attempt", { offerRef, caseRef: plan.caseRef, profileRef: plan.profileRef, buyer: r.buyer.address });
        const typed = q.buyerAuthorization;
        const signature = await r.buyer.signTypedData({ ...typed, domain: { ...typed.domain, chainId: Number(typed.domain.chainId) } });
        const funded = await call("lemma_fund_attempt", { attemptId: q.attemptId, validAfter: typed.message.validAfter, validBefore: typed.message.validBefore, signature });
        const attempt = { ...plan, offerRef, attemptId: q.attemptId, quoteDigest: q.quoteDigest, fundingTotal: formatUsdc(q.fundingTotal), steps: {} };
        step(attempt, "fund", funded);
        attempts.push(attempt);
        if (plan.label === "timeout") continue;
        const issued = desk.issued(q.attemptId), info = await settlement.attemptInfo(q.attemptId);
        const evaluation = await evaluator.evaluate({ quote: issued.quote, record: issued.record, salt: issued.salt, caseRef: plan.caseRef, fundedAt: info.fundedAt, chainTime: await chainTime() });
        assert.equal(evaluation.outcome, plan.label);
        const settled = await settlement.settle({ wallet: wallet(r.evaluator), quote: issued.quote, receipt: evaluation.receipt, signature: evaluation.signature });
        await confirm(settled);
        step(attempt, "settle", settled);
        Object.assign(issued, { receipt: evaluation.receipt });
      }
      // The timeout attempt was funded first; nobody submits its receipt, so wait out settleBy.
      const timeout = attempts[0], held = desk.issued(timeout.attemptId);
      if (target === "fork") {
        await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(held.quote.settleBy) + 1] });
        await publicClient.request({ method: "evm_mine", params: [] });
      } else {
        while (BigInt(await chainTime()) <= BigInt(held.quote.settleBy)) await new Promise(resolve => setTimeout(resolve, 5000));
      }
      const refunded = await settlement.refundTimeout({ wallet: wallet(r.evaluator), quote: held.quote });
      await confirm(refunded);
      step(timeout, "refundTimeout", refunded);
      for (const attempt of attempts) attempt.state = (await call("lemma_attempt_status", { attemptId: attempt.attemptId })).state;
      // LemmaX realizes its execution charges, its only revenue under the agreed terms.
      const earned = await settlement.credit(r.facilitator.address);
      const withdrawn = await settlement.withdraw({ wallet: wallet(r.facilitator), amount: earned, destination: r.facilitator.address });
      await confirm(withdrawn);
      const ledger = await settlement.ledger();
      const fromBlock = deployment ? BigInt(deployment.blockNumber) : BigInt(env.LEMMAX_SETTLEMENT_FROM_BLOCK ?? 0);
      const logs = await readSettlementLogs({ publicClient, address, fromBlock, toBlock: await publicClient.getBlockNumber(), maxBlockRange: 100n });
      const private_ = attempts.map(a => ({ quote: desk.issued(a.attemptId).quote, receipt: desk.issued(a.attemptId).receipt ?? null }));
      const onchainStates = Object.fromEntries(attempts.map(a => [a.attemptId, a.state]));
      const reconciliation = reconcileAttempts({ logs, domain, attempts: private_, onchainStates, ledger });
      return plain({ schemaVersion: "testnet-demo/v1", target, dryRun: false, chainId: chain.id, settlement: address, observedAt: Math.floor(Date.now() / 1000),
        codeSha256: sourceHashes(["contracts/AttemptSettlement.sol", "src/attempt.mjs", "src/settlement.mjs", "src/issuer.mjs", "src/evaluator.mjs", "src/purchase.mjs",
          "src/mcp.mjs", "src/directory.mjs", "src/terms.mjs", "src/reconcile.mjs", "src/monad.mjs", "scripts/testnet-demo.mjs"]),
        ...(target === "testnet" ? { explorer: `${EXPLORER}/address/${address}` } : {}),
        deployment: deployment && { transactionHash: deployment.transactionHash, blockNumber: deployment.blockNumber, gasUsed: deployment.gasUsed, gasLimit: deployment.gasLimit, maskedRuntimeSha256: deployment.maskedRuntimeSha256 },
        terms: DEMO_TERMS, assessments, chosenOffer: offerRef, attempts,
        lemmaxWithdrawal: { amount: formatUsdc(earned), transactionHash: withdrawn.hash },
        reconciliation: { ok: reconciliation.ok, attempts: reconciliation.attempts.map(a => ({ attemptId: a.attemptId, state: a.state, allocation: a.allocation, issues: a.issues })), issues: reconciliation.issues },
        ledger, balancesBefore: before, balancesAfter: await balances(publicClient, usdc, roleAddresses) });
    } finally { await agent.close(); await server.close(); }
  } finally { if (node) await node.stop(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.env);
    const text = JSON.stringify(result, null, 2) + "\n";
    if (process.env.LEMMAX_DEMO_OUTPUT) writeFileSync(process.env.LEMMAX_DEMO_OUTPUT, text);
    process.stdout.write(text);
  } catch (error) { console.error(`Demo stopped: ${error.shortMessage ?? error.message}`); process.exitCode = 1; }
}
