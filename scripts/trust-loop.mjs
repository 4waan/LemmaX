import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PrivyClient } from "@privy-io/node";
import { createWalletClient, getAddress, getContractAddress, http } from "viem";
import { compileSettlement } from "./compile-settlement.mjs";
import { deploySettlement, verifyDeployment } from "./deploy-settlement.mjs";
import { forkMinter } from "./fork-usdc.mjs";
import { connectWhenReady, sourceHashes, startAnvil } from "./settlement-check.mjs";
import { loadRetrievalReport } from "./verify-retrieval.mjs";
import { balances, roles } from "./testnet-demo.mjs";
import { RECEIVE_AUTHORIZATION_TYPES } from "../src/attempt.mjs";
import { createAuditClient } from "../src/audit.mjs";
import { createEvaluator } from "../src/evaluator.mjs";
import { createBuyerGuard } from "../src/guard.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { evaluatorBAccount } from "../src/keys.mjs";
import { createLocalAudit } from "../src/local-audit.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { MONAD_NETWORKS, connectMonad, waitForStage } from "../src/monad.mjs";
import { commitStageStream } from "../src/operator.mjs";
import { buyerPrivyKeys, createConditionSetClient, createPrivyBuyerSigner, normalizedSignature, privyKeySeparation } from "../src/privy-buyer.mjs";
import { createPurchaseDesk, plain } from "../src/purchase.mjs";
import { readSettlementLogs, reconcileAttempts } from "../src/reconcile.mjs";
import { RULEBOOK, RULEBOOK_HASH } from "../src/rulebook.mjs";
import { createSettlementClient } from "../src/settlement.mjs";
import { SCIFACT_PROFILE, createSciFactIndex, loadSciFact } from "../src/scifact.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { DEMO_TERMS, formatUsdc } from "../src/terms.mjs";

// The LemmaX trust loop in a few plain beats, on a fork rehearsal or on Monad Testnet:
// an agent buys outcome-conditioned retrieval with a wallet that signs only what the
// buyer's guard approved; funding streams Monad's commit states; settlement pays owners
// automatically, so nobody needs MON to collect; a labelled evaluator overcharges once,
// the audit flags it and the next quote naming it is refused before anything is signed.
// Keys come from the environment and are never printed. Testnet sends nothing unless
// LEMMAX_DEMO_BROADCAST=1.
const HEADROOM_BPS = 1000;
const EXPLORER = "https://testnet.monadvision.com";
const SCENARIO = "demo-terms-llm-reads-corpus/v1";

// Rehearsal mandate: the same rule Privy's TEE enforces (sign only approved digests),
// applied locally when no Privy wallet is configured. Labelled as such in the report.
function localMandate(account) {
  const approved = new Set();
  return {
    conditionSets: { add: async (setId, values) => values.map(v => (approved.add(v.toLowerCase()), { id: v.toLowerCase(), value: v.toLowerCase() })), remove: async (setId, id) => approved.delete(id) },
    signer: { address: account.address, async signFundingAuthorization(typed) {
      if (!approved.has(String(typed.message.nonce).toLowerCase())) throw new Error("policy_violation: digest not approved");
      const typedData = { domain: { ...typed.domain, chainId: Number(typed.domain.chainId) }, types: RECEIVE_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message: typed.message };
      return normalizedSignature(typedData, await account.signTypedData(typedData), account.address);
    } },
  };
}

function plansFrom(report, offerRef) {
  const rows = report.perCase.filter(row => row.outputs[offerRef]);
  const hits = rows.filter(row => row.outputs[offerRef].success), misses = rows.filter(row => !row.outputs[offerRef].success);
  return [
    { label: "timeout", caseRef: hits[1].caseRef, profileRef: "demo-timeout/v1", evaluator: "main", settle: false },
    { label: "success", caseRef: hits[0].caseRef, profileRef: "demo-standard/v1", evaluator: "main", settle: true },
    { label: "eligible_failure", caseRef: misses[0].caseRef, profileRef: "demo-standard/v1", evaluator: "main", settle: true },
    { label: "overcharge", caseRef: hits[2].caseRef, profileRef: "demo-standard/v1", evaluator: "evaluator-b", settle: true },
    { label: "refused", caseRef: hits[3].caseRef, profileRef: "demo-standard/v1", evaluator: "evaluator-b", settle: false },
  ];
}

async function main(env, say) {
  const target = env.LEMMAX_DEMO_TARGET;
  if (!["fork", "testnet"].includes(target)) throw new TypeError("Set LEMMAX_DEMO_TARGET to fork or testnet");
  const r = roles(env), evaluatorB = evaluatorBAccount(env);
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
      rpc = env.LEMMAX_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
      connection = await connectMonad({ network: "testnet", rpcUrl: rpc, pollingInterval: 300 });
    }
    const { chain, publicClient } = connection;
    const wallet = account => createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) });
    const artifact = compileSettlement();
    const predicted = getContractAddress({ from: r.deployer.address, nonce: BigInt(await publicClient.getTransactionCount({ address: r.deployer.address })) });
    let address = env.LEMMAX_SETTLEMENT_ADDRESS ? getAddress(env.LEMMAX_SETTLEMENT_ADDRESS) : null, fromBlock;
    if (target === "testnet" && env.LEMMAX_DEMO_BROADCAST !== "1") {
      return { dryRun: true, target, settlement: address ?? `to be deployed at ${predicted}`, buyer: env.LEMMAX_BUYER ?? "env",
        auditor: env.LEMMAX_AUDITOR_URL ? "envio" : "local", next: "Set LEMMAX_DEMO_BROADCAST=1 to run on Monad Testnet." };
    }
    if (address) {
      if (!/^[0-9]+$/.test(env.LEMMAX_SETTLEMENT_FROM_BLOCK ?? "")) throw new TypeError("Set LEMMAX_SETTLEMENT_FROM_BLOCK to the contract's deployment block");
      await verifyDeployment({ publicClient, address, artifact, issuer: r.facilitator.address, asset: usdc });
      fromBlock = BigInt(env.LEMMAX_SETTLEMENT_FROM_BLOCK);
    } else {
      // On testnet the auditor watches one address; never deploy a new one by accident.
      if (target === "testnet" && env.LEMMAX_DEPLOY_NEW !== "1") throw new TypeError("Set LEMMAX_SETTLEMENT_ADDRESS and LEMMAX_SETTLEMENT_FROM_BLOCK, or LEMMAX_DEPLOY_NEW=1 to deploy a new contract");
      const deployment = await deploySettlement({ publicClient, wallet: wallet(r.deployer), artifact, issuer: r.facilitator.address, asset: usdc,
        gasHeadroomBps: HEADROOM_BPS, stage: "verified", pollMs: 300, timeoutMs: 180000 });
      address = deployment.address; fromBlock = BigInt(deployment.blockNumber);
      say(`Contract v3 deployed at ${address}${address === getAddress("0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7") ? " (the address the auditor watches)" : ""}`);
    }
    const settlement = createSettlementClient({ publicClient, address, gasHeadroomBps: HEADROOM_BPS });
    const token = await settlement.asset();
    const domain = { chainId: String(chain.id), verifyingContract: address };
    const chainTime = async () => (await publicClient.getBlock()).timestamp.toString();
    const confirm = result => waitForStage(publicClient, result, "verified", { pollMs: 300, timeoutMs: 180000 });
    const [mainEvaluator, rosterB] = RULEBOOK.roles.evaluators;
    const issuer = createQuoteIssuer({ account: r.facilitator, domain, token, caps: r.caps,
      payees: { connector: r.provider, executor: r.facilitator.address, evaluator: mainEvaluator.payee, evaluatorSigner: r.evaluator.address },
      evaluators: { "evaluator-b": { evaluator: rosterB.payee, evaluatorSigner: evaluatorB.address } } });
    const evaluators = { main: createEvaluator({ account: r.evaluator, domain, index, data }),
      "evaluator-b": createEvaluator({ account: evaluatorB, domain, index, data, terms: { ...DEMO_TERMS, evaluationCharge: "1000" } }) };
    let assigned;
    const desk = createPurchaseDesk({ issuer, settlement, relayer: wallet(r.facilitator), data, chainTime, confirm,
      stages: target === "testnet" ? commitStageStream({ env, network: "testnet", address }) : null, chooseEvaluator: () => assigned });
    // Buyer side: the guard (deterministic, holds the guard key) and the wallet the agent signs with.
    const localAudit = createLocalAudit({ publicClient, address, fromBlock });
    const envio = env.LEMMAX_AUDITOR_URL ? createAuditClient({ url: env.LEMMAX_AUDITOR_URL, publicClient }) : null;
    let buyerWallet, conditionSets, setId, mandate;
    if ((env.LEMMAX_BUYER ?? "env") === "privy") {
      const privyBuyer = JSON.parse(readFileSync(new URL("../deployments/privy-buyer.json", import.meta.url), "utf8"));
      const keys = buyerPrivyKeys(env);
      buyerWallet = createPrivyBuyerSigner({ privy: new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }), walletId: privyBuyer.walletId,
        address: privyBuyer.address, agentPrivateKey: keys.agent.privateKey });
      const { generateAuthorizationSignature } = await import("@privy-io/node");
      conditionSets = createConditionSetClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, ownerPrivateKey: keys.guard.privateKey, sign: generateAuthorizationSignature });
      setId = privyBuyer.conditionSetId; mandate = "Privy server wallet (TEE policy)";
    } else {
      const local = localMandate(r.buyer);
      buyerWallet = local.signer; conditionSets = local.conditionSets; setId = "local"; mandate = "local rehearsal of the mandate";
    }
    const guard = createBuyerGuard({ buyer: buyerWallet.address, domain, approvedIssuer: () => settlement.approvedIssuer(), chainTime,
      audit: envio ?? localAudit, conditionSets, setId, auditRequired: env.LEMMAX_AUDIT_REQUIRED !== "false" });
    // The agent talks to LemmaX only through MCP.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(createPublicDirectory({ report, index, data }), desk, { audit: envio ?? localAudit });
    const agent = new Client({ name: "LemmaX-buyer-agent", version: "1.0.0" });
    await server.connect(serverTransport); await agent.connect(clientTransport);
    const call = async (name, args, onprogress) => {
      const result = await agent.callTool({ name, arguments: args }, undefined, { timeout: 240000, resetTimeoutOnProgress: true, ...(onprogress ? { onprogress } : {}) });
      if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
      return result.structuredContent;
    };
    const before = await balances(publicClient, usdc, { buyer: buyerWallet.address, provider: r.provider, evaluator: r.evaluator.address, evaluatorB: evaluatorB.address, facilitator: r.facilitator.address });
    const link = hash => (target === "testnet" ? `${EXPLORER}/tx/${hash}` : hash);
    const beats = [];
    let indexedThrough = null;
    try {
      const assessed = await call("lemma_assess", { profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: SCENARIO });
      const offerRef = assessed.results.find(x => x.rank === 1)?.offerRef;
      if (!offerRef) throw new Error("No offer ranks under the declared alternative");
      say(`Agent ranks offers under its declared alternative and buys ${offerRef}`);
      for (const plan of plansFrom(report, offerRef)) {
        assigned = plan.evaluator === "main" ? undefined : plan.evaluator;
        const beat = { ...plan, steps: {} };
        beats.push(beat);
        const q = await call("lemma_quote_attempt", { offerRef, caseRef: plan.caseRef, profileRef: plan.profileRef, buyer: buyerWallet.address });
        beat.attemptId = q.attemptId;
        const approval = await guard.approve({ quote: q.quote, issuerSignature: q.issuerSignature, buyerAuthorization: q.buyerAuthorization, indexedThrough });
        if (!approval.approved) {
          // Nothing is signed and nothing reaches the chain.
          let signed = true;
          try { await buyerWallet.signFundingAuthorization(q.buyerAuthorization); } catch { signed = false; }
          Object.assign(beat, { refused: approval.reasons, walletSigned: signed });
          say(`${plan.label.padEnd(16)} guard refused (${approval.reasons.join(", ")}); the wallet ${signed ? "SIGNED (unexpected)" : "would not sign"}; nothing sent`);
          continue;
        }
        const signature = await buyerWallet.signFundingAuthorization(q.buyerAuthorization);
        const stages = [];
        const funded = await call("lemma_fund_attempt", { attemptId: q.attemptId, validAfter: q.buyerAuthorization.message.validAfter,
          validBefore: q.buyerAuthorization.message.validBefore, signature }, p => stages.push(p.message));
        await guard.release(approval);
        beat.steps.fund = { transactionHash: funded.transactionHash, timeline: funded.timeline, link: link(funded.transactionHash) };
        const verified = funded.timeline.find(t => t.step === "Verified");
        say(`${plan.label.padEnd(16)} funded: ${stages.join(" > ")}${verified ? ` in ${(verified.ms / 1000).toFixed(1)} s` : ""}`);
        if (!plan.settle) continue;
        const issued = desk.issued(q.attemptId), info = await settlement.attemptInfo(q.attemptId);
        const evaluation = await evaluators[plan.evaluator].evaluate({ quote: issued.quote, record: issued.record, salt: issued.salt, caseRef: plan.caseRef, fundedAt: info.fundedAt, chainTime: await chainTime() });
        // The main evaluator's wallet submits every receipt; evaluator-b holds no MON.
        const settled = await settlement.settle({ wallet: wallet(r.evaluator), quote: issued.quote, receipt: evaluation.receipt, signature: evaluation.signature });
        await confirm(settled);
        Object.assign(issued, { receipt: evaluation.receipt });
        beat.steps.settle = { transactionHash: settled.hash, outcome: evaluation.outcome, charges: `${evaluation.receipt.executionUsed}/${evaluation.receipt.evaluationUsed}`, link: link(settled.hash) };
        say(`${plan.label.padEnd(16)} settled ${evaluation.outcome} at ${beat.steps.settle.charges}${plan.evaluator === "main" ? "" : " by the labelled evaluator-b"}`);
        indexedThrough = settled.blockNumber.toString();
        // The next quote must be judged on an index that has seen this settlement.
        if (envio) {
          const until = Date.now() + 120000;
          while (BigInt((await envio.freshness()).progressBlock ?? 0) < settled.blockNumber) {
            if (Date.now() > until) throw new Error("The auditor did not index the settlement within two minutes");
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          beat.steps.settle.indexedAfterMs = Date.now() - (until - 120000);
        }
      }
      const timeout = beats.find(b => b.label === "timeout"), held = desk.issued(timeout.attemptId);
      if (target === "fork") {
        await publicClient.request({ method: "evm_setNextBlockTimestamp", params: [Number(held.quote.settleBy) + 1] });
        await publicClient.request({ method: "evm_mine", params: [] });
      } else {
        while (BigInt(await chainTime()) <= BigInt(held.quote.settleBy)) await new Promise(resolve => setTimeout(resolve, 3000));
      }
      const refunded = await settlement.refundTimeout({ wallet: wallet(r.evaluator), quote: held.quote });
      await confirm(refunded);
      timeout.steps.refundTimeout = { transactionHash: refunded.hash, link: link(refunded.hash) };
      say(`${"timeout".padEnd(16)} refunded after its deadline`);
    } finally { await agent.close(); await server.close(); }
    const logs = await readSettlementLogs({ publicClient, address, fromBlock, toBlock: await publicClient.getBlockNumber(), maxBlockRange: 100n });
    const paid = logs.filter(l => l.eventName === "CreditPaid");
    for (const p of paid) say(`Paid automatically: ${formatUsdc(p.amount)} USDC to ${p.owner === buyerWallet.address ? "the buyer" : p.owner === r.provider ? "the provider" : p.owner} (no MON needed)`);
    const funded = beats.filter(b => b.steps.fund);
    const reconciliation = reconcileAttempts({ logs, domain, ledger: await settlement.ledger(),
      attempts: funded.map(b => ({ quote: desk.issued(b.attemptId).quote, receipt: desk.issued(b.attemptId).receipt ?? null })) });
    const local = await localAudit.snapshot();
    const flagged = Object.values(local.records).filter(x => x.blocking > 0).map(x => ({ party: x.party, lastVerdict: x.lastVerdict }));
    let envioAgreement = null;
    if (envio) {
      const parties = Object.keys(local.records);
      const { records } = await envio.partyRecords(parties);
      envioAgreement = parties.every(p => Number(records[p]?.blocking ?? 0) === local.records[p].blocking);
    }
    say(`Audit: ${flagged.length ? flagged.map(f => `${f.lastVerdict} by ${f.party}`).join("; ") : "no findings"}${envio ? `; Envio and the local audit ${envioAgreement ? "agree" : "DISAGREE"}` : ""}`);
    say(`Reconciliation: ${reconciliation.ok ? "every attempt, allocation and payout matches" : "issues found"}`);
    return plain({ schemaVersion: "trust-loop/v1", target, chainId: chain.id, settlement: address, fromBlock: fromBlock.toString(), mandate,
      buyerKeys: mandate.startsWith("Privy") ? { ownSecret: privyKeySeparation(env) } : null,
      auditor: envio ? "envio" : "local", rulebook: { ref: RULEBOOK.rulebookRef, hash: RULEBOOK_HASH }, buyer: buyerWallet.address,
      codeSha256: sourceHashes(["contracts/AttemptSettlement.sol", "src/guard.mjs", "src/privy-buyer.mjs", "src/purchase.mjs", "src/mcp.mjs", "src/rulebook.mjs",
        "indexer/src/shared/conformance.mjs", "src/local-audit.mjs", "src/reconcile.mjs", "scripts/trust-loop.mjs"]),
      beats, payouts: paid.map(p => ({ owner: p.owner, destination: p.destination, amount: p.amount, transactionHash: p.transactionHash })),
      deferred: reconciliation.deferred, flagged, envioAgreement,
      reconciliation: { ok: reconciliation.ok, issues: reconciliation.issues, attempts: reconciliation.attempts.map(a => ({ attemptId: a.attemptId, state: a.state, issues: a.issues })) },
      ledger: await settlement.ledger(), balancesBefore: before,
      balancesAfter: await balances(publicClient, usdc, { buyer: buyerWallet.address, provider: r.provider, evaluator: r.evaluator.address, evaluatorB: evaluatorB.address, facilitator: r.facilitator.address }) });
  } finally { if (node) await node.stop(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const urls = [process.env.LEMMAX_MONAD_RPC_URL, process.env.LEMMAX_FORK_RPC_URL].filter(Boolean);
  const scrub = text => urls.reduce((t, url) => t.split(url).join("<rpc-url>"), String(text));
  try {
    const result = await main(process.env, line => console.error(line));
    const text = JSON.stringify(result, null, 2) + "\n";
    if (process.env.LEMMAX_DEMO_OUTPUT) writeFileSync(process.env.LEMMAX_DEMO_OUTPUT, text);
    else process.stdout.write(text);
  } catch (error) {
    console.error(`Trust loop stopped: ${scrub(error.shortMessage ?? error.message)}${error.hash ? ` (transaction ${error.hash})` : ""}`);
    process.exitCode = 1;
  }
}
