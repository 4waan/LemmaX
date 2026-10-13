import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { createAuditClient, verifyAttempt } from "../src/audit.mjs";
import { localMandateWallet } from "../src/buyer-wallet.mjs";
import { createBuyerGuard } from "../src/guard.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { createLocalAudit } from "../src/local-audit.mjs";
import { connectMonad } from "../src/monad.mjs";
import { RULEBOOK, RULEBOOK_HASH } from "../src/rulebook.mjs";
import { createSettlementClient } from "../src/settlement.mjs";
import { DEMO_TERMS, usdcAtomic } from "../src/terms.mjs";
import { V3 } from "../web/live.mjs";

// Checks the hosted Envio auditor against Monad Testnet, read only:
// - its freshness against the chain head;
// - every contract v3 attempt against the local auditor, which applies the same shared
//   rules to RPC logs (state, rebuilt allocation and rule findings);
// - every contract v2 attempt against the outcome recorded when it ran;
// - the buyer's guard approving a fresh bill while reading it. That bill is signed by
//   the issuer key locally and never relayed, so nothing is broadcast.
// Writes verification/auditor-check-testnet.json. Keys are read from the environment
// and never printed.
const V2 = "0xfb59487E973C883E3fe4301238D485f7B248fA7f";
const RECORDED = { success: "settled_success", eligible_failure: "settled_failure", timeout: "refunded_timeout" };
const canon = value => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k, String(v)]).sort()));
const codes = verdicts => verdicts.map(v => v.code).sort();

async function graphql(url, query) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw new Error("The auditor query failed");
  return body.data;
}

export async function auditorCheck(env = process.env) {
  const url = env.LEMMAX_AUDITOR_URL;
  if (!url) throw new TypeError("Set LEMMAX_AUDITOR_URL to the hosted auditor's GraphQL endpoint");
  const { chain, publicClient } = await connectMonad({ network: "testnet", rpcUrl: env.LEMMAX_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz", pollingInterval: 300 });
  const envio = createAuditClient({ url, publicClient, timeoutMs: 15000 });
  const local = createLocalAudit({ publicClient, address: V3.address, fromBlock: BigInt(V3.fromBlock) });
  const data = await graphql(url, `{
    Attempt { id settlement state termsSource }
    PartyRecord { party rulebookHash attempts blocking recorded informational }
    Payout { owner amount kind txHash }
  }`);
  const attempts = [];
  for (const row of data.Attempt) {
    const envioView = await verifyAttempt(envio, row.id);
    if (row.settlement.toLowerCase() === V3.address.toLowerCase()) {
      const localView = await verifyAttempt(local, row.id);
      attempts.push({ attemptId: row.id, contract: "v3", state: envioView.state, termsSource: row.termsSource, findings: codes(envioView.verdicts),
        comparedWith: "local auditor", matches: envioView.state === localView.state && canon(envioView.allocation) === canon(localView.allocation)
          && JSON.stringify(codes(envioView.verdicts)) === JSON.stringify(codes(localView.verdicts)) });
    } else if (row.settlement.toLowerCase() === V2.toLowerCase()) {
      const v2 = JSON.parse(readFileSync(new URL("../verification/testnet-demo.json", import.meta.url), "utf8"));
      const recorded = v2.attempts.find(a => a.attemptId.toLowerCase() === row.id.toLowerCase());
      attempts.push({ attemptId: row.id, contract: "v2", state: envioView.state, termsSource: row.termsSource, findings: codes(envioView.verdicts),
        comparedWith: "outcome recorded when it ran", matches: Boolean(recorded) && RECORDED[recorded.label] === envioView.state });
    }
  }
  let guard = null;
  if (env.FACILITATOR_PRIVATE_KEY && env.BENCHMARK_BUYER_PRIVATE_KEY) {
    const settlement = createSettlementClient({ publicClient, address: V3.address, gasHeadroomBps: 1000 });
    const token = await settlement.asset();
    const domain = { chainId: String(chain.id), verifyingContract: settlement.address };
    const issuerAccount = privateKeyToAccount(env.FACILITATOR_PRIVATE_KEY), buyer = privateKeyToAccount(env.BENCHMARK_BUYER_PRIVATE_KEY);
    const [checker] = RULEBOOK.roles.evaluators;
    const total = BigInt(DEMO_TERMS.principal) + BigInt(DEMO_TERMS.executionCap) + BigInt(DEMO_TERMS.evaluationCap);
    const issuer = createQuoteIssuer({ account: issuerAccount, domain, token, caps: { maxPerAttempt: total, dailyCap: total },
      payees: { connector: RULEBOOK.roles.connectors[0].address, executor: issuerAccount.address, evaluator: checker.payee, evaluatorSigner: checker.signer } });
    const chainTime = async () => (await publicClient.getBlock()).timestamp.toString();
    const bill = await issuer.issue({ offerRef: "lemmax/tfidf-source-retrieval/v1", caseRef: "1014", query: "public benchmark claim 1014", buyer: buyer.address,
      profileRef: "demo-standard/v1", issuedAt: await chainTime() });
    const mandate = localMandateWallet({ account: buyer, chainId: chain.id, usdc: token.address, settlement: settlement.address, maxValue: total });
    const buyerGuard = createBuyerGuard({ buyer: buyer.address, domain, approvedIssuer: () => settlement.approvedIssuer(), chainTime,
      audit: envio, conditionSets: mandate.conditionSets, setId: "local" });
    // The newest settlement this buyer knows of: the auditor must already have processed it.
    const runs = JSON.parse(readFileSync(new URL("../verification/live-runs-testnet.json", import.meta.url), "utf8")).runs;
    const lastSettled = runs.map(r => BigInt(r.block)).reduce((a, b) => (b > a ? b : a), 0n).toString();
    const started = Date.now();
    const approval = await buyerGuard.approve({ quote: bill.quote, issuerSignature: bill.issuerSignature, buyerAuthorization: bill.authorization, indexedThrough: lastSettled });
    guard = { approved: approval.approved, reasons: approval.reasons, indexedThrough: lastSettled, ms: Date.now() - started, broadcast: false };
    await buyerGuard.release(approval);
  }
  const freshness = await envio.freshness();
  return { schemaVersion: "auditor-check/v1", network: "testnet", chainId: chain.id, endpoint: url, rulebookHash: RULEBOOK_HASH,
    freshness: { progressBlock: freshness.progressBlock, lagBlocks: freshness.lagBlocks },
    passed: attempts.length > 0 && attempts.every(a => a.matches) && (guard === null || guard.approved),
    attempts, parties: data.PartyRecord.map(p => ({ party: p.party, rulebookHash: p.rulebookHash, attempts: p.attempts, blocking: p.blocking })),
    payouts: data.Payout.map(p => ({ owner: p.owner, amount: p.amount, kind: p.kind, txHash: p.txHash })), guard };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await auditorCheck();
    writeFileSync(new URL("../verification/auditor-check-testnet.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
    const matched = report.attempts.filter(a => a.matches).length;
    console.log(`Auditor ${report.passed ? "passed" : "FAILED"}: ${matched} of ${report.attempts.length} attempts match, lag ${report.freshness.lagBlocks} blocks, guard ${report.guard ? (report.guard.approved ? "approved" : "refused") : "not checked"}`);
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(`Auditor check could not run: ${error instanceof TypeError || error instanceof RangeError ? error.message : error?.shortMessage ?? error?.message}`);
    process.exitCode = 1;
  }
}
