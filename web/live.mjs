import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RECEIVE_AUTHORIZATION_TYPES } from "../src/attempt.mjs";
import { createAuditClient, verifyAttempt } from "../src/audit.mjs";
import { createEvaluator } from "../src/evaluator.mjs";
import { createBuyerGuard } from "../src/guard.mjs";
import { createQuoteIssuer } from "../src/issuer.mjs";
import { evaluatorBAccount } from "../src/keys.mjs";
import { createLocalAudit } from "../src/local-audit.mjs";
import { MONAD_NETWORKS, connectMonad, envAddress, waitForStage } from "../src/monad.mjs";
import { commitStageStream } from "../src/operator.mjs";
import { buyerPrivyKeys, createConditionSetClient, createPrivyBuyerSigner, normalizedSignature } from "../src/privy-buyer.mjs";
import { createPurchaseDesk, plain } from "../src/purchase.mjs";
import { readSettlementLogs } from "../src/reconcile.mjs";
import { RULEBOOK, RULEBOOK_HASH, publicAllocation } from "../src/rulebook.mjs";
import { createSettlementClient } from "../src/settlement.mjs";
import { DEMO_TERMS, formatUsdc, usdcAtomic } from "../src/terms.mjs";

// The live desk behind LemmaX's public page. It runs both sides of a purchase on Monad
// Testnet so a visitor can watch one, with the buyer's side kept separate in code: the
// guard and the buyer's wallet only ever see what an agent would hand them. Keys come from
// the environment and are never printed or returned. Everything a visitor triggers is
// capped per visitor and per day.
export const EXPLORER = "https://testnet.monadvision.com";
export const V3 = Object.freeze({ address: "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7", fromBlock: "70137467" });
export const OFFER = "lemmax/tfidf-source-retrieval/v1";
export const TRICKS = Object.freeze(["flagged_checker", "redirect_payment", "skip_guard"]);
const HEADROOM_BPS = 1000;
const DAY = 86400;

function key(env, name) {
  try { return privateKeyToAccount(env[name]); } catch { throw new TypeError(`${name} is missing or is not a private key`); }
}

// Six public claims a visitor can buy a search for: four the offer finds a right source
// for and two it misses, so the refund path is one click away. Retrieval is deterministic,
// so each label states what will happen; the checker still decides on chain.
export function pickClaims({ report, data, offerRef = OFFER, hits = 4, misses = 2, maxLength = 110 }) {
  const rows = report.perCase.filter(row => row.representative && row.outputs[offerRef] && data.queries.has(row.caseRef));
  const short = rows.filter(row => data.queries.get(row.caseRef).length <= maxLength);
  const take = (success, n) => short.filter(row => row.outputs[offerRef].success === success).slice(0, n)
    .map(row => ({ caseRef: row.caseRef, claim: data.queries.get(row.caseRef), expected: success ? "found" : "missed" }));
  return [...take(true, hits), ...take(false, misses)];
}

// Who is paid what in one settlement transaction: transfers made automatically, and
// credit left owed below the payout minimum (paid automatically once it reaches it).
export function receiptFrom({ logs, txHash, quote, outcome, credits, names }) {
  const paid = logs.filter(l => l.transactionHash === txHash && l.eventName === "CreditPaid");
  const deferred = logs.filter(l => l.transactionHash === txHash && l.eventName === "PayoutDeferred");
  const allocation = publicAllocation(quote, outcome);
  const parties = [["provider", quote.connectorPayee, allocation.connector], ["LemmaX (execution)", quote.executorPayee, allocation.executor],
    ["checker", quote.evaluatorPayee, allocation.evaluator], ["buyer (returned)", quote.buyer, allocation.buyer]];
  const low = value => String(value).toLowerCase();
  const credit = Object.fromEntries(Object.entries(credits).map(([k, v]) => [low(k), v]));
  const name = Object.fromEntries(Object.entries(names).map(([k, v]) => [low(k), v]));
  return parties.filter(([, , amount]) => BigInt(amount) > 0n).map(([role, address, amount]) => {
    const owner = low(address);
    const transfer = paid.find(p => low(p.owner) === owner);
    return { role, name: name[owner] ?? null, address, earned: formatUsdc(amount),
      paidNow: transfer ? formatUsdc(transfer.amount) : "0", deferred: deferred.some(d => low(d.owner) === owner),
      creditOwed: formatUsdc(credit[owner] ?? "0") };
  });
}

// Small persistent state: per-day counters, so a restart cannot reset the daily caps.
// With LEMMAX_STATE_DIR unset (local runs) it lives in memory only.
export function createState(dir) {
  const path = dir ? join(dir, "live-state.json") : null;
  let state = { days: {} };
  if (path) {
    let stored;
    try { stored = readFileSync(path, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw new Error("Live demo state could not be read", { cause: error });
    }
    if (stored !== undefined) {
      try { state = JSON.parse(stored); }
      catch (error) { throw new Error("Live demo state contains invalid JSON", { cause: error }); }
      const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
      const count = value => Number.isSafeInteger(value) && value >= 0;
      if (!object(state) || !object(state.days) || !Object.entries(state.days).every(([day, record]) =>
        /^(0|[1-9][0-9]*)$/.test(day) && count(Number(day)) && object(record) && count(record.buys) && count(record.tricks)
        && typeof record.issued === "string" && /^(0|[1-9][0-9]*)$/.test(record.issued)
        && Array.isArray(record.visitors) && record.visitors.every(visitor => typeof visitor === "string"))) {
        throw new Error("Live demo state has invalid counters");
      }
    }
  }
  const save = () => {
    if (!path) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(state)); renameSync(`${path}.tmp`, path);
  };
  return {
    day(dayNumber) {
      const k = String(dayNumber);
      state.days[k] ??= { buys: 0, tricks: 0, issued: "0", visitors: [] };
      for (const old of Object.keys(state.days)) if (Number(old) < dayNumber - 7) delete state.days[old];
      return state.days[k];
    },
    save,
  };
}

// Sliding-window limits per visitor, in memory; the daily caps are the persistent backstop.
export function createLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return (visitor) => {
    const t = now(), recent = (hits.get(visitor) ?? []).filter(x => t - x < windowMs);
    if (recent.length >= limit) { hits.set(visitor, recent); return { ok: false, retryInMs: windowMs - (t - recent[0]) }; }
    recent.push(t); hits.set(visitor, recent);
    if (hits.size > 10000) for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k);
    return { ok: true };
  };
}

// Reserve a day's slot only when a run starts. The queue also keeps the relayer's nonce,
// wallet approval set and index wait exclusive. A failed run still used its slot.
export function createRunQueue({ state, limits, dayNow }) {
  for (const kind of ["buys", "tricks"]) {
    if (!Number.isSafeInteger(limits[kind]) || limits[kind] < 0) throw new RangeError(`${kind} daily limit must be a non-negative integer`);
  }
  const exhausted = {
    buys: "Today's demo budget is used up. The public record and the tricks still work.",
    tricks: "Today's trick budget is used up.",
  };
  let busy = Promise.resolve();
  return (kind, visitor, task) => {
    if (!Object.hasOwn(exhausted, kind)) throw new TypeError("Unknown live run kind");
    const run = busy.then(async () => {
      const today = state.day(dayNow());
      if (today[kind] >= limits[kind]) throw new RangeError(exhausted[kind]);
      today[kind] += 1;
      if (visitor && !today.visitors.includes(visitor)) today.visitors.push(visitor);
      state.save();
      return task(today);
    });
    busy = run.catch(() => {});
    return run;
  };
}

// Rehearsal mandate for runs without a Privy wallet: the same single ALLOW rule the Privy
// policy holds, checked locally, and labelled as a rehearsal wherever it is reported.
export function localMandateWallet({ account, chainId, usdc, settlement, maxValue }) {
  const approved = new Set();
  const deny = reason => Object.assign(new Error(`Policy refused: ${reason}`), { status: 403, policy: true });
  return {
    conditionSets: {
      add: async (setId, values) => values.map(v => { const x = String(v).toLowerCase(); approved.add(x); return { id: x, value: x }; }),
      remove: async (setId, id) => { approved.delete(String(id).toLowerCase()); },
    },
    signer: { address: account.address, label: "local rehearsal of the wallet policy",
      async signFundingAuthorization(typed) {
        const m = typed.message;
        if (Number(typed.domain.chainId) !== Number(chainId) || getAddress(typed.domain.verifyingContract) !== getAddress(usdc)) throw deny("wrong chain or token");
        if (getAddress(m.to) !== getAddress(settlement)) throw deny("the payment does not go to the settlement contract");
        if (BigInt(m.value) > BigInt(maxValue)) throw deny("amount above the limit");
        if (!approved.has(String(m.nonce).toLowerCase())) throw deny("this bill was not approved by the guard");
        const typedData = { domain: { ...typed.domain, chainId: Number(typed.domain.chainId) }, types: RECEIVE_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization", message: m };
        return normalizedSignature(typedData, await account.signTypedData(typedData), account.address);
      } },
  };
}

// A refusal from the wallet, reduced to what a visitor may see: who refused and why.
export function walletRefusal(error, mode) {
  const status = Number(error?.status) || null;
  const byPolicy = error?.policy || (status >= 400 && status < 500);
  const raw = String(error?.message ?? "refused").replace(/0x[0-9a-fA-F]{64,}/g, "0x…").slice(0, 240);
  return { refused: true, by: mode === "privy" ? "Privy (wallet policy in its secure enclave)" : "wallet policy (local rehearsal)", status, byPolicy: Boolean(byPolicy), message: raw };
}

export async function createLiveDesk({ env, data, report, now = () => Date.now() }) {
  const network = "testnet";
  const rpcUrl = env.LEMMAX_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
  const { chain, publicClient } = await connectMonad({ network, rpcUrl, pollingInterval: 300 });
  const wallet = account => createWalletClient({ account, chain, transport: http(rpcUrl, { retryCount: 0 }) });
  const issuerAccount = key(env, "FACILITATOR_PRIVATE_KEY"), evaluatorAccount = key(env, "EVALUATOR_PRIVATE_KEY"), evaluatorB = evaluatorBAccount(env);
  const provider = envAddress(env, "LEMMA_PROVIDER_ADDRESS");
  const address = envAddress(env, "LEMMAX_SETTLEMENT_ADDRESS", { optional: true }) ?? getAddress(V3.address);
  const fromBlock = BigInt(env.LEMMAX_SETTLEMENT_FROM_BLOCK ?? V3.fromBlock);
  const settlement = createSettlementClient({ publicClient, address, gasHeadroomBps: HEADROOM_BPS });
  if (await settlement.approvedIssuer() !== issuerAccount.address) throw new TypeError("The settlement contract names a different issuer");
  const token = await settlement.asset();
  const domain = { chainId: String(chain.id), verifyingContract: settlement.address };
  const chainTime = async () => (await publicClient.getBlock()).timestamp.toString();
  const confirm = result => waitForStage(publicClient, result, "verified", { pollMs: 300, timeoutMs: 180000 });
  const total = BigInt(DEMO_TERMS.principal) + BigInt(DEMO_TERMS.executionCap) + BigInt(DEMO_TERMS.evaluationCap);
  const caps = { maxPerAttempt: usdcAtomic(env.LEMMA_MAX_USDC_PER_RESOLUTION ?? formatUsdc(total)), dailyCap: usdcAtomic(env.LEMMA_DAILY_USDC_CAP ?? "1") };
  const limits = { buysPerDay: Number(env.LEMMAX_LIVE_BUYS_PER_DAY ?? 60), tricksPerDay: Number(env.LEMMAX_LIVE_TRICKS_PER_DAY ?? 400) };
  const [mainEvaluator, rosterB] = RULEBOOK.roles.evaluators;
  const payees = { connector: provider, executor: issuerAccount.address, evaluator: mainEvaluator.payee, evaluatorSigner: evaluatorAccount.address };
  const roster = { "evaluator-b": { evaluator: rosterB.payee, evaluatorSigner: evaluatorB.address } };
  // Purchases and the tricks use separate issuers: quotes made for a trick are never in the
  // desk's book, so they can never be relayed, and they do not use up the purchase budget.
  const issuer = createQuoteIssuer({ account: issuerAccount, domain, token, caps, payees, evaluators: roster });
  const trickIssuer = createQuoteIssuer({ account: issuerAccount, domain, token, caps: { maxPerAttempt: caps.maxPerAttempt, dailyCap: total * BigInt(limits.tricksPerDay) }, payees, evaluators: roster });
  let assigned;
  const desk = createPurchaseDesk({ issuer, settlement, relayer: wallet(issuerAccount), data, chainTime, confirm,
    stages: commitStageStream({ env, network, address: settlement.address }), chooseEvaluator: () => assigned });
  const { createSciFactIndex } = await import("../src/scifact.mjs");
  const index = createSciFactIndex(data);
  const evaluator = createEvaluator({ account: evaluatorAccount, domain, index, data });
  // Auditor: the hosted Envio index when configured; otherwise the same rules over RPC logs.
  const audit = env.LEMMAX_AUDITOR_URL ? createAuditClient({ url: env.LEMMAX_AUDITOR_URL, publicClient })
    : createLocalAudit({ publicClient, address: settlement.address, fromBlock });
  const auditor = env.LEMMAX_AUDITOR_URL ? "envio" : "local";
  // The local fallback reads logs from the contract's first block; start that in the background.
  if (auditor === "local") audit.snapshot().catch(() => {});
  // Buyer side: a Privy server wallet whose policy signs only guard-approved bills, or the
  // local rehearsal of that policy when no Privy wallet is configured.
  let buyerWallet, conditionSets, setId, mode;
  const privyRecord = env.LEMMAX_PRIVY_BUYER_FILE ?? new URL("../deployments/privy-buyer.json", import.meta.url);
  if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET && existsSync(privyRecord)) {
    const { PrivyClient, generateAuthorizationSignature } = await import("@privy-io/node");
    const record = JSON.parse(readFileSync(privyRecord, "utf8")), keys = buyerPrivyKeys(env);
    buyerWallet = createPrivyBuyerSigner({ privy: new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET }), walletId: record.walletId,
      address: record.address, agentPrivateKey: keys.agent.privateKey });
    conditionSets = createConditionSetClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, ownerPrivateKey: keys.guard.privateKey, sign: generateAuthorizationSignature });
    setId = record.conditionSetId; mode = "privy";
  } else {
    const local = localMandateWallet({ account: key(env, "BENCHMARK_BUYER_PRIVATE_KEY"), chainId: chain.id, usdc: token.address, settlement: settlement.address, maxValue: total });
    buyerWallet = local.signer; conditionSets = local.conditionSets; setId = "local"; mode = "local";
  }
  const guard = createBuyerGuard({ buyer: buyerWallet.address, domain, approvedIssuer: () => settlement.approvedIssuer(), chainTime, audit, conditionSets, setId,
    auditRequired: env.LEMMAX_AUDIT_REQUIRED !== "false" });
  const names = { [getAddress(provider)]: "Provider", [issuerAccount.address]: "LemmaX", [getAddress(mainEvaluator.payee)]: "Checker",
    [getAddress(rosterB.payee)]: "Checker B (staged fault)", [getAddress(buyerWallet.address)]: "Buyer agent" };
  const claims = pickClaims({ report, data });
  const offerRates = Object.fromEntries(report.offers?.map?.(o => [o.offerRef, o]) ?? []);
  const state = createState(env.LEMMAX_STATE_DIR);
  const dayNow = () => Math.floor(now() / 1000 / DAY);
  issuer.restore(dayNow(), state.day(dayNow()).issued);
  let lastSettledBlock = null;
  const run = createRunQueue({ state, limits: { buys: limits.buysPerDay, tricks: limits.tricksPerDay }, dayNow });
  const visitorHash = ip => createHash("sha256").update(`${dayNow()}:${ip}:${salt}`).digest("hex").slice(0, 16);
  const salt = randomBytes(16).toString("hex");
  const link = hash => `${EXPLORER}/tx/${hash}`;

  async function waitForIndex(block, emit) {
    if (auditor !== "envio") return { ms: 0, progressBlock: block.toString() };
    const started = now(), until = started + 120000;
    for (;;) {
      const f = await audit.freshness().catch(() => null);
      if (f?.progressBlock && BigInt(f.progressBlock) >= block) return { ms: now() - started, progressBlock: f.progressBlock };
      if (now() > until) throw new Error("The public record did not catch up within two minutes");
      emit?.({ type: "waiting", id: "recorded", progressBlock: f?.progressBlock ?? null, target: block.toString() });
      await new Promise(resolve => setTimeout(resolve, 700));
    }
  }

  async function buy({ caseRef, visitor }, emit) {
    const claim = claims.find(c => c.caseRef === caseRef);
    if (!claim) throw new TypeError("Pick one of the listed claims");
    return run("buys", visitor, async today => {
      const started = now(), t = () => now() - started;
      assigned = undefined;
      const q = await desk.quote({ offerRef: OFFER, caseRef, profileRef: "demo-standard/v1", buyer: buyerWallet.address });
      today.issued = issuer.issuedOn(dayNow()); state.save();
      emit({ type: "step", id: "quote", t: t(), attemptId: q.attemptId, held: formatUsdc(q.fundingTotal), price: formatUsdc(DEMO_TERMS.principal),
        checker: names[getAddress(q.quote.evaluatorPayee)] ?? q.quote.evaluatorPayee, claim: claim.claim });
      const approval = await guard.approve({ quote: q.quote, issuerSignature: q.issuerSignature, buyerAuthorization: q.buyerAuthorization, indexedThrough: lastSettledBlock });
      emit({ type: "step", id: "guard", t: t(), approved: approval.approved, reasons: approval.reasons, auditor });
      if (!approval.approved) return { refused: approval.reasons };
      let signature;
      try { signature = await buyerWallet.signFundingAuthorization(q.buyerAuthorization); }
      catch (error) { await guard.release(approval).catch(() => {}); emit({ type: "step", id: "wallet", t: t(), ...walletRefusal(error, mode) }); return { refused: ["wallet"] }; }
      emit({ type: "step", id: "wallet", t: t(), signed: true, by: mode === "privy" ? "Privy" : "local rehearsal" });
      let funded;
      try {
        funded = await desk.fund({ attemptId: q.attemptId, validAfter: q.buyerAuthorization.message.validAfter, validBefore: q.buyerAuthorization.message.validBefore, signature },
          { onProgress: p => emit({ type: "stage", t: t(), step: p.message }) });
      } finally { await guard.release(approval).catch(() => {}); }
      emit({ type: "step", id: "locked", t: t(), tx: funded.transactionHash, link: link(funded.transactionHash), timeline: funded.timeline, block: String(funded.blockNumber) });
      const issued = desk.issued(q.attemptId), info = await settlement.attemptInfo(q.attemptId);
      const evaluation = await evaluator.evaluate({ quote: issued.quote, record: issued.record, salt: issued.salt, caseRef, fundedAt: info.fundedAt, chainTime: await chainTime() });
      emit({ type: "step", id: "checked", t: t(), outcome: evaluation.outcome, found: evaluation.evidence.sources.map(s => s.sourceRef), relevant: evaluation.evidence.checks.relevant });
      if (!evaluation.receipt) throw new Error("The checker could not settle this attempt; it will refund in full after its deadline");
      const settled = await settlement.settle({ wallet: wallet(evaluatorAccount), quote: issued.quote, receipt: evaluation.receipt, signature: evaluation.signature });
      await confirm(settled);
      lastSettledBlock = settled.blockNumber.toString();
      emit({ type: "step", id: "settled", t: t(), tx: settled.hash, link: link(settled.hash), outcome: evaluation.outcome });
      const recorded = await waitForIndex(settled.blockNumber, emit);
      emit({ type: "step", id: "recorded", t: t(), auditor, ...recorded });
      const logs = await readSettlementLogs({ publicClient, address: settlement.address, fromBlock: settled.blockNumber, toBlock: settled.blockNumber, maxBlockRange: 1n });
      const outcome = { state: evaluation.outcome === "success" ? "settled_success" : "settled_failure", executionUsed: evaluation.receipt.executionUsed, evaluationUsed: evaluation.receipt.evaluationUsed };
      const owners = [issued.quote.connectorPayee, issued.quote.executorPayee, issued.quote.evaluatorPayee, issued.quote.buyer].map(a => getAddress(a));
      const credits = Object.fromEntries(await Promise.all(owners.map(async o => [o, await settlement.credit(o)])));
      const payouts = receiptFrom({ logs, txHash: settled.hash, quote: issued.quote, outcome, credits, names });
      emit({ type: "receipt", t: t(), attemptId: q.attemptId, outcome: evaluation.outcome, payouts, links: { fund: link(funded.transactionHash), settle: link(settled.hash) } });
      return { attemptId: q.attemptId, outcome: evaluation.outcome };
    });
  }

  async function trick({ kind, visitor }, emit) {
    if (!TRICKS.includes(kind)) throw new TypeError("Unknown trick");
    return run("tricks", visitor, async () => {
      const started = now(), t = () => now() - started;
      const caseRef = claims[0].caseRef;
      const issued = await trickIssuer.issue({ offerRef: OFFER, caseRef, query: data.queries.get(caseRef), buyer: buyerWallet.address, profileRef: "demo-standard/v1",
        issuedAt: await chainTime(), evaluatorRef: kind === "flagged_checker" ? "evaluator-b" : undefined });
      const bill = { quote: plain(issued.quote), issuerSignature: issued.issuerSignature, buyerAuthorization: plain(issued.authorization) };
      emit({ type: "step", id: "quote", t: t(), checker: names[getAddress(issued.quote.evaluatorPayee)] ?? issued.quote.evaluatorPayee, note: "a real bill, signed by LemmaX, that will never be sent" });
      const trySign = async typed => {
        try { await buyerWallet.signFundingAuthorization(typed); return { refused: false, signedUnexpectedly: true }; }
        catch (error) { return walletRefusal(error, mode); }
      };
      if (kind === "skip_guard") {
        emit({ type: "step", id: "guard", t: t(), skipped: true });
        const wallet = await trySign(bill.buyerAuthorization);
        emit({ type: "step", id: "wallet", t: t(), ...wallet });
        return { held: !wallet.signedUnexpectedly };
      }
      const approval = await guard.approve({ ...bill, indexedThrough: lastSettledBlock });
      emit({ type: "step", id: "guard", t: t(), approved: approval.approved, reasons: approval.reasons, auditor });
      try {
        if (kind === "flagged_checker") {
          // The guard should refuse; ask the wallet anyway, as an agent that ignores its guard would.
          const wallet = await trySign(bill.buyerAuthorization);
          emit({ type: "step", id: "wallet", t: t(), ...wallet });
          return { held: !approval.approved && !wallet.signedUnexpectedly };
        }
        // redirect_payment: the guard approved the real bill; the agent changes who gets paid.
        const attacker = privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`).address;
        const tampered = { ...bill.buyerAuthorization, message: { ...bill.buyerAuthorization.message, to: attacker } };
        emit({ type: "step", id: "tamper", t: t(), change: "who gets paid", to: attacker });
        const wallet = await trySign(tampered);
        emit({ type: "step", id: "wallet", t: t(), ...wallet });
        return { held: !wallet.signedUnexpectedly };
      } finally { await guard.release(approval).catch(() => {}); }
    });
  }

  // Look up an attempt by id or by a transaction hash from its funding or settlement.
  async function record(query) {
    if (typeof query !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(query)) throw new TypeError("Paste a 0x attempt id or transaction hash");
    let attemptId = query;
    const receipt = await publicClient.getTransactionReceipt({ hash: query }).catch(() => null);
    if (receipt) {
      const logs = await readSettlementLogs({ publicClient, address: settlement.address, fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber, maxBlockRange: 1n });
      const hit = logs.find(l => l.transactionHash.toLowerCase() === query.toLowerCase() && l.attemptId);
      if (!hit) throw new TypeError("That transaction is not a LemmaX attempt");
      attemptId = hit.attemptId;
    }
    const verified = await verifyAttempt(audit, attemptId);
    return { ...verified, auditor, links: { fund: verified.fundTx ? link(verified.fundTx) : null, outcome: verified.outcomeTx ? link(verified.outcomeTx) : null } };
  }

  const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]).catch(() => null);
  async function status() {
    const [freshness, usdc, mon, b] = await Promise.all([
      within(audit.freshness(), 3000),
      publicClient.readContract({ address: token.address, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [buyerWallet.address] }),
      publicClient.getBalance({ address: buyerWallet.address }),
      within(audit.partyRecords([evaluatorB.address]), 3000)]);
    const today = state.day(dayNow());
    const flagged = b?.records?.[evaluatorB.address.toLowerCase()];
    return { network: "Monad Testnet", chainId: chain.id, settlement: settlement.address, contractLink: `${EXPLORER}/address/${settlement.address}`,
      rulebook: { ref: RULEBOOK.rulebookRef, hash: RULEBOOK_HASH }, auditor, freshness, wallet: { mode, address: buyerWallet.address, usdc: formatUsdc(usdc), mon: (Number(mon) / 1e18).toString() },
      checkerB: { address: evaluatorB.address, flagged: Boolean(flagged && Number(flagged.blocking) > 0), lastVerdict: flagged?.lastVerdict ?? null, lastVerdictTx: flagged?.lastVerdictTx ?? null },
      today: { buys: today.buys, buysLeft: Math.max(0, limits.buysPerDay - today.buys), visitors: today.visitors.length },
      offers: Object.values(offerRates).map(o => ({ offerRef: o.offerRef, name: o.method === "bm25" ? "Search A (BM25)" : "Search B (TF-IDF)", successes: o.successes, cases: o.cases, used: o.offerRef === OFFER })),
      price: { held: formatUsdc(total), principal: formatUsdc(DEMO_TERMS.principal), execution: formatUsdc(DEMO_TERMS.executionCharge), checking: formatUsdc(DEMO_TERMS.evaluationCharge) } };
  }

  return { buy, trick, record, status, claims, visitorHash, audit, mode, auditor, settlement: settlement.address, buyer: buyerWallet.address, publicClient };
}
