import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileSettlement } from "./compile-settlement.mjs";
import { deploySettlement } from "./deploy-settlement.mjs";
import { forkMinter } from "./fork-usdc.mjs";
import { connectWhenReady, startAnvil } from "./settlement-check.mjs";
import { createEvaluator } from "../src/evaluator.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { evaluatorBAccount } from "../src/keys.mjs";
import { MONAD_NETWORKS, waitForStage } from "../src/monad.mjs";
import { RULEBOOK } from "../src/rulebook.mjs";
import { createSettlementClient } from "../src/settlement.mjs";
import { SCIFACT_PROFILE, createSciFactIndex, loadSciFact } from "../src/scifact.mjs";
import { DEMO_TERMS, usdcAtomic } from "../src/terms.mjs";
import { localMandateWallet } from "../web/live.mjs";
import { startServer } from "../web/server.mjs";

// Rehearses the public page end to end on a local fork of Monad Testnet: a fresh contract,
// a staged overcharge by the labelled checker B so the public record has a finding, then
// the page's own HTTP API: two purchases (one hit, one miss), the three tricks, the record
// lookup and the read-only MCP endpoint. The wallet policy and the auditor run locally here.
// Keys come from the environment and are never printed.
async function readStream(response) {
  const text = await response.text();
  return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

async function main(env, say) {
  if (!env.LEMMAX_FORK_RPC_URL) throw new TypeError("Set LEMMAX_FORK_RPC_URL to a Monad Testnet endpoint");
  const key = name => privateKeyToAccount(env[name]);
  const deployer = key("DEPLOYER_PRIVATE_KEY"), facilitator = key("FACILITATOR_PRIVATE_KEY"), evaluator = key("EVALUATOR_PRIVATE_KEY"), buyer = key("BENCHMARK_BUYER_PRIVATE_KEY");
  const evaluatorB = evaluatorBAccount(env), usdc = MONAD_NETWORKS.testnet.usdc;
  const node = await startAnvil(["--fork-url", env.LEMMAX_FORK_RPC_URL, "--block-time", "1"]);
  let server = null;
  try {
    const { chain, publicClient } = await connectWhenReady(node, "testnet");
    const minter = await forkMinter({ publicClient, chain, rpc: node.rpc, usdc });
    for (const a of [deployer, facilitator, evaluator]) await minter.setMon(a.address, 10n ** 18n);
    await minter.mint(buyer.address, 200000n);
    const wallet = account => createWalletClient({ account, chain, transport: http(node.rpc, { retryCount: 0 }) });
    const deployment = await deploySettlement({ publicClient, wallet: wallet(deployer), artifact: compileSettlement(), issuer: facilitator.address, asset: usdc,
      gasHeadroomBps: 1000, stage: "verified", pollMs: 100, timeoutMs: 60000 });
    say(`Fresh contract on the fork at ${deployment.address}`);
    // Stage the finding the page's first trick relies on: checker B overcharges once.
    const settlement = createSettlementClient({ publicClient, address: deployment.address, gasHeadroomBps: 1000 });
    const token = await settlement.asset(), domain = { chainId: String(chain.id), verifyingContract: deployment.address };
    const data = loadSciFact(env.LEMMAX_SCIFACT_DIR), index = createSciFactIndex(data);
    const [main, rosterB] = RULEBOOK.roles.evaluators;
    const issuer = createQuoteIssuer({ account: facilitator, domain, token, caps: { maxPerAttempt: usdcAtomic("0.25"), dailyCap: usdcAtomic("1") },
      payees: { connector: env.LEMMA_PROVIDER_ADDRESS, executor: facilitator.address, evaluator: main.payee, evaluatorSigner: evaluator.address },
      evaluators: { "evaluator-b": { evaluator: rosterB.payee, evaluatorSigner: evaluatorB.address } } });
    const now = async () => (await publicClient.getBlock()).timestamp.toString();
    const staged = await issuer.issue({ offerRef: "lemmax/tfidf-source-retrieval/v1", caseRef: "3", query: data.queries.get("3"), buyer: buyer.address,
      profileRef: "demo-standard/v1", issuedAt: await now(), evaluatorRef: "evaluator-b" });
    const mandate = localMandateWallet({ account: buyer, chainId: chain.id, usdc: token.address, settlement: deployment.address, maxValue: 8000n });
    await mandate.conditionSets.add("local", [staged.quoteDigest]);
    const signature = await mandate.signer.signFundingAuthorization(staged.authorization);
    const funded = await settlement.fund({ wallet: wallet(facilitator), quote: staged.quote, issuerSignature: staged.issuerSignature,
      authorization: { validAfter: staged.authorization.message.validAfter, validBefore: staged.authorization.message.validBefore, signature } });
    await waitForStage(publicClient, funded, "verified", { pollMs: 100, timeoutMs: 60000 });
    const info = await settlement.attemptInfo(staged.quote.attemptId);
    const overcharging = createEvaluator({ account: evaluatorB, domain, index, data, terms: { ...DEMO_TERMS, evaluationCharge: "1000" } });
    const evaluation = await overcharging.evaluate({ quote: staged.quote, record: staged.record, salt: staged.salt, caseRef: "3", fundedAt: info.fundedAt, chainTime: await now() });
    const settled = await settlement.settle({ wallet: wallet(evaluator), quote: staged.quote, receipt: evaluation.receipt, signature: evaluation.signature });
    await waitForStage(publicClient, settled, "verified", { pollMs: 100, timeoutMs: 60000 });
    say("Staged: checker B charged 0.0010 against a published 0.0008");

    // The page, as Railway would run it, pointed at the fork.
    const started = await startServer({ port: 0, log: () => {}, env: { ...env, LEMMAX_MONAD_RPC_URL: node.rpc, LEMMAX_MONAD_WS_URL: "off",
      LEMMAX_SETTLEMENT_ADDRESS: deployment.address, LEMMAX_SETTLEMENT_FROM_BLOCK: String(deployment.blockNumber), LEMMAX_AUDITOR_URL: "",
      PRIVY_APP_ID: "", LEMMAX_STATE_DIR: "" } });
    server = started.server;
    const base = `http://127.0.0.1:${started.port}`;
    const get = async path => (await fetch(`${base}${path}`)).json();
    const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const status = await get("/api/status");
    const { claims } = await get("/api/claims");
    const hit = claims.find(c => c.expected === "found"), miss = claims.find(c => c.expected === "missed");
    const purchases = [];
    for (const claim of [hit, miss]) {
      const events = await readStream(await post("/api/buy", { caseRef: claim.caseRef }));
      const step = id => events.find(e => e.type === "step" && e.id === id);
      const receipt = events.find(e => e.type === "receipt");
      const error = events.find(e => e.type === "error");
      if (error) throw new Error(`Purchase failed: ${error.message}`);
      purchases.push({ expected: claim.expected, outcome: step("checked")?.outcome, guard: step("guard")?.approved, stages: events.filter(e => e.type === "stage").map(e => e.step),
        settleTx: step("settled")?.tx, payouts: receipt?.payouts ?? [] });
      say(`Buy (${claim.expected}): ${step("checked")?.outcome}; ${receipt.payouts.map(p => `${p.role} ${p.earned}${p.paidNow !== "0" ? ` paid ${p.paidNow}` : ""}`).join(", ")}`);
    }
    const tricks = {};
    for (const kind of ["flagged_checker", "redirect_payment", "skip_guard"]) {
      const events = await readStream(await post("/api/trick", { kind }));
      const guard = events.find(e => e.type === "step" && e.id === "guard"), walletStep = events.find(e => e.type === "step" && e.id === "wallet");
      const done = events.find(e => e.type === "done");
      tricks[kind] = { guard: guard?.skipped ? "skipped" : guard?.approved ? "approved" : `refused: ${(guard?.reasons ?? []).join(", ")}`,
        wallet: walletStep?.refused ? `refused: ${walletStep.message}` : "signed", held: Boolean(done?.result?.held) };
      say(`Trick ${kind}: guard ${tricks[kind].guard}; wallet ${tricks[kind].wallet}`);
    }
    const record = await get(`/api/record?q=${purchases[1].settleTx}`);
    say(`Record for the miss: ${record.summary}`);
    const mcp = new Client({ name: "live-check", version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const tools = (await mcp.listTools()).tools.map(t => t.name);
    const offers = (await mcp.callTool({ name: "lemma_list_offers", arguments: {} })).structuredContent.offers.map(o => [o.offerRef, o.observedHitRate]);
    await mcp.close();
    say(`MCP over HTTP: ${tools.join(", ")}`);
    const checks = {
      purchasesSettledAsExpected: purchases[0].outcome === "success" && purchases[1].outcome === "eligible_failure",
      fundingReportedVerified: purchases.every(p => p.stages.includes("Verified")),
      providerPaidOnHit: purchases[0].payouts.some(p => p.role === "provider" && p.paidNow !== "0"),
      priceReturnedOnMiss: purchases[1].payouts.some(p => p.role.startsWith("buyer") && p.earned === "0.0057"),
      flaggedCheckerRefusedByGuard: tricks.flagged_checker.guard.includes("evaluator_flagged"),
      tricksNeverSigned: Object.values(tricks).every(t => t.held && t.wallet.startsWith("refused")),
      redirectApprovedByGuardRefusedByWallet: tricks.redirect_payment.guard === "approved" && tricks.redirect_payment.wallet.startsWith("refused"),
      recordShowsRefund: record.found === true && record.state === "settled_failure",
      mcpReadOnly: tools.includes("lemma_list_offers") && !tools.includes("lemma_fund_attempt"),
      statusShowsZeroMon: Number(status.wallet.mon) === 0,
    };
    say(`Checks: ${Object.values(checks).filter(Boolean).length} of ${Object.keys(checks).length} passed`);
    return { schemaVersion: "live-check/v1", target: "fork", chainId: chain.id, settlement: deployment.address, profile: SCIFACT_PROFILE.profileRef,
      wallet: status.wallet.mode, auditor: status.auditor, passed: Object.values(checks).every(Boolean), checks, purchases, tricks,
      record: { state: record.state, summary: record.summary }, mcp: { tools, offers } };
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await node.stop();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scrub = text => [process.env.LEMMAX_FORK_RPC_URL].filter(Boolean).reduce((t, url) => t.split(url).join("<rpc-url>"), String(text));
  try {
    const result = await main(process.env, line => console.error(line));
    const text = JSON.stringify(result, null, 2) + "\n";
    if (process.env.LEMMAX_LIVE_CHECK_OUTPUT) writeFileSync(process.env.LEMMAX_LIVE_CHECK_OUTPUT, text);
    else process.stdout.write(text);
    if (!result.passed) process.exitCode = 2;
  } catch (error) {
    console.error(`Live check stopped: ${scrub(error.shortMessage ?? error.message)}`);
    process.exitCode = 1;
  }
}
