// The hero terminal: what a Claude Code session using LemmaX looks like. The offers and the
// assessment come live from this server's own MCP endpoint, the same calls an agent makes.
// On load the payment steps replay the latest settled run, with its real transactions.
// "Run it live" makes a real purchase on Monad Testnet and prints each step as it happens.
const $ = id => document.getElementById(id);
const term = $("term");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let explorer = "https://testnet.monadvision.com", status = null, recent = null, claims = [], playing = false, nextLive = "found";
const FALLBACK = "demo-terms-llm-reads-corpus/v1", OWN = "demo-terms-own-pipeline/v1";

// Small DOM helpers. Everything shown comes from our own API, but text is never parsed as HTML.
function el(tag, cls, ...kids) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
const span = (cls, ...kids) => el("span", cls, ...kids);
const short = h => `${h.slice(0, 6)}…${h.slice(-4)}`;
const tx = (hash, label = short(hash)) => { const a = el("a", "", label); a.href = `${explorer}/tx/${hash}`; a.target = "_blank"; a.rel = "noopener"; return a; };
const pct = x => `${Math.round(x * 100)}%`;
const usd = (x, d = 3) => Number(x).toFixed(d);
const sleep = ms => new Promise(r => setTimeout(r, reduced ? 0 : ms));
const scroll = () => { term.scrollTop = term.scrollHeight; };
function add(node) { node.classList.add("t-in"); term.append(node); scroll(); return node; }

async function getJson(url) { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Unavailable"); return j; }
let rpc = 0;
async function mcp(name, args = {}) {
  const r = await fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const j = await r.json();
  if (j.error || j.result?.isError) throw new Error(j.result?.content?.[0]?.text ?? j.error?.message ?? "Tool failed");
  return j.result.structuredContent;
}

// Terminal lines, shaped like Claude Code's: a prompt box, tool calls with a status dot, and
// indented results under an elbow.
async function prompt(text) {
  const body = span("");
  const line = add(el("p", "t-prompt", span("gt", "> "), body));
  if (reduced) { body.textContent = text; return line; }
  const caret = span("caret");
  line.append(caret);
  for (let i = 1; i <= text.length; i++) { body.textContent = text.slice(0, i); await sleep(text.length > 80 ? 12 : 22); }
  caret.remove();
  return line;
}
function tool(server, name, arg) {
  const line = add(el("p", "t-tool run", span("dot", "● "), span("srv", `${server} · `), span("t-b", name), arg ? span("arg", `  ${arg}`) : null));
  return { done: () => line.classList.remove("run"), fail: () => { line.classList.remove("run"); line.classList.add("err"); } };
}
function out(...rows) {
  const nodes = rows.map((row, i) => add(el("div", "t-out", span("elbow", i === 0 ? "  ⎿ " : ""), el("div", "", row))));
  return nodes[nodes.length - 1];
}
const say = text => add(el("p", "t-say", span("dot", "● "), text));
const dim = text => add(el("p", "t-faint", text));
const ok = (...kids) => [span("t-ok", "✓ "), ...kids];

function setMode(kind, label) {
  const chip = $("termMode");
  chip.textContent = label;
  chip.className = kind === "live" ? "chip live" : "chip";
}

// One session, two sources: a recorded run (replay) or the live purchase stream.
async function session({ claim, live, caseRef, run }) {
  playing = true; $("runLive").disabled = true; $("replay").hidden = true;
  term.replaceChildren();
  const w = status?.wallet;
  dim(`lemmax connected · agent wallet ${w ? `${w.usdc} USDC, ${Number(w.mon) === 0 ? "0" : Number(w.mon).toFixed(2)} MON` : "USDC only"}`);
  await sleep(500);
  await prompt(`Find a peer-reviewed source for "${claim.replace(/[.\s]+$/, "")}". Spend under a cent.`);
  await sleep(500);

  // Discovery and the decision, live from /mcp.
  let t = tool("lemmax", "lemma_list_offers");
  const offers = await mcp("lemma_list_offers").catch(() => null);
  await sleep(350);
  if (!offers) { t.fail(); out(span("t-no", "LemmaX is unreachable right now.")); return finish(); }
  t.done();
  const tf = offers.offers.find(o => o.method !== "bm25"), bm = offers.offers.find(o => o.method === "bm25");
  out(el("span", "", `right source in the top five: tfidf ${Math.round(tf.observedHitRate * tf.measuredCases)} of ${tf.measuredCases} claims, bm25 ${Math.round(bm.observedHitRate * bm.measuredCases)}`));
  await sleep(600);

  t = tool("lemmax", "lemma_assess", "fallback: Claude Haiku reads the corpus");
  const a = await mcp("lemma_assess", { profileRef: offers.profileRef, scenarioRef: FALLBACK }).catch(() => null);
  await sleep(450);
  if (!a) { t.fail(); out(span("t-no", "Assessment unavailable.")); return finish(); }
  t.done();
  const rows = [...a.results].sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99));
  out(el("span", "cols t-mute", span("", "offer"), span("", "hit, 95% range"), span("", "cost to answer"), span("wide", "saves"), span("", "")),
    ...rows.map(r => el("span", "cols", span("t-b", r.offerRef.includes("bm25") ? "bm25" : "tfidf"),
      span("", `${pct(r.pOutcome.mean)} [${pct(r.pOutcome.interval.low)}, ${pct(r.pOutcome.interval.high)}]`),
      span(r.rank === 1 ? "t-ok" : "", `${usd(r.cReuse)} USDC`), span("wide", `${pct(r.expectedSaving / (r.expectedSaving + r.cReuse))}`),
      span("t-faint", r.rank === 1 ? "← best" : ""))),
    span("t-faint", `without LemmaX: ${usd(rows[0].expectedSaving + rows[0].cReuse)} USDC per answer`));
  await sleep(700);

  // The purchase: from the live stream, or from the recorded run.
  const view = { quote: null, guard: null, wallet: null, fund: null, stages: null, deliver: null, receipt: null };
  const price = status?.price ?? { held: "0.008", principal: "0.005", execution: "0.0015", checking: "0.0008" };
  const steps = {
    quote(e) {
      view.quote = tool("lemmax", "lemma_quote_attempt", `tfidf · claim ${caseRef}`);
      view.quote.done();
      out(el("span", "", "bill ", span("t-acc", short(e.attemptId)), ` · holds ${e.held ?? price.held} USDC · search ${e.price ?? price.principal} only on a hit`),
        span("t-faint", "private record committed as a salted hash on the bill"));
    },
    guard(e) {
      view.guard = tool("wallet", "wallet_sign_bill");
      if (!e.approved) { view.guard.fail(); out(span("t-no", `guard refused: ${e.reasons.join(", ")}`)); return; }
      out(ok(`guard: ${e.auditor === "envio" ? "Envio" : "auditor"} current, no findings on the bill's parties`));
    },
    wallet(e) {
      if (e.refused) { view.guard?.fail(); out(span("t-no", `${e.by} refused: ${e.message}`)); return; }
      view.guard?.done();
      out(ok(`${e.by === "Privy" ? "Privy" : "wallet"} policy signed this bill's hash, nothing else`));
      view.fund = tool("lemmax", "lemma_fund_attempt");
      view.stageRow = el("span", "stages", ...["Relayed", "Proposed", "Voted", "Finalized", "Verified"].map(s => { const n = span("", s); n.dataset.s = s; return n; }));
      out(view.stageRow);
      view.relayAt = null;
    },
    stage(e) {
      const n = view.stageRow?.querySelector(`[data-s="${e.step}"]`);
      if (!n) return;
      if (e.step === "Relayed") view.relayAt = e.t;
      n.classList.add("on");
      if (e.step !== "Relayed" && view.relayAt != null && e.t != null) n.append(el("i", "", ` ${((e.t - view.relayAt) / 1000).toFixed(2)} s`));
    },
    locked(e) {
      for (const s of view.stageRow?.querySelectorAll("span[data-s]") ?? []) if (!s.classList.contains("on")) s.textContent = `${s.dataset.s} ·`;
      view.fund?.done();
      out(el("span", "", `${price.held} USDC held on Monad${e.block ? ` in block ${e.block}` : ""} · `, tx(e.tx)));
      view.deliver = tool("lemmax", "lemma_deliver_attempt");
    },
    checked(e) {
      const hit = e.outcome === "success";
      out(el("span", "", `${e.found?.length ?? 5} sources · checker: `, span(hit ? "t-ok" : "t-warn", hit ? "hit, a relevant source" : "miss, nothing relevant")));
    },
    settled(e) { view.settleTx = e.tx; },
    receipt(e) {
      view.deliver?.done();
      const by = role => e.payouts?.find(p => p.role === role)?.earned ?? "0";
      out(el("span", "", `search ${by("provider")} · LemmaX ${by("LemmaX (execution)")} · checker ${by("checker")} · `,
        span(e.outcome === "success" ? "" : "t-ok", `back ${by("buyer (returned)")}`)),
        el("span", "t-faint", "settled in one Monad transaction · ", tx(e.settleTx)));
      view.receipt = e;
    },
  };

  if (live) {
    let failed = null;
    try {
      await stream("/api/buy", { caseRef }, e => {
        if (e.type === "error") failed = e.message;
        else if (e.type === "stage") steps.stage(e);
        else if (e.type === "receipt") steps.receipt(e);
        else if (e.type === "step" && steps[e.id]) steps[e.id](e);
      });
    } catch (err) { failed = err.message; }
    if (!view.receipt) { out(span("t-no", failed ?? "The run stopped before settling.")); return finish(); }
  } else {
    // A recorded run: the same steps, paced like the real thing.
    const timeline = run.timeline?.length ? run.timeline : null;
    steps.quote({ attemptId: run.attemptId }); await sleep(800);
    if (run.earlier) {
      tool("wallet", "wallet_sign_bill").done();
      out(span("t-faint", "this run is from contract v2, before the guard and wallet policy were added"));
    } else {
      steps.guard({ approved: true, auditor: status?.auditor }); await sleep(600);
    }
    steps.wallet({ signed: true, by: status?.wallet?.mode === "privy" ? "Privy" : "wallet" }); await sleep(300);
    if (timeline) {
      let last = 0;
      for (const s of timeline) { await sleep(Math.min(900, s.ms - last)); last = s.ms; steps.stage({ step: s.step, t: s.ms }); }
    } else { await sleep(700); steps.stage({ step: "Relayed", t: 0 }); await sleep(900); steps.stage({ step: "Verified", t: null }); }
    await sleep(300); steps.locked({ tx: run.fundTx, block: run.block }); await sleep(900);
    steps.checked({ outcome: run.outcome, found: [1, 2, 3, 4, 5] }); await sleep(700);
    steps.receipt(run); await sleep(500);
  }

  // The audit, live from /mcp when the auditor answers.
  if (!run?.earlier) {
    t = tool("lemmax", "lemma_verify_attempt");
    const v = await Promise.race([mcp("lemma_verify_attempt", { attemptId: (view.receipt ?? run).attemptId }).catch(() => null), sleep(6000).then(() => null)]);
    t.done();
    if (v?.found) {
      const flagged = (v.verdicts ?? []).filter(x => x.severity !== "informational");
      out(flagged.length ? span("t-no", `${flagged.length} rule finding(s): ${flagged.map(x => x.code).join(", ")}`)
        : el("span", "", ok("rebuilt from Monad logs, follows rulebook "), span("t-acc", short(v.rulebookHash))));
    } else out(span("t-faint", "settled on chain; the auditor has not indexed it yet"));
  }
  await sleep(500);
  const r = view.receipt ?? run, hit = r.outcome === "success";
  const back = r.payouts?.find(p => p.role === "buyer (returned)")?.earned;
  say(hit ? `Found one. The provider earned ${r.payouts?.find(p => p.role === "provider")?.earned ?? price.principal} USDC because the checker confirmed it.`
    : `Nothing relevant, so ${back ?? "the price"} USDC came back. Try bm25 next?`);
  finish();
}

function finish() { playing = false; $("runLive").disabled = false; $("replay").hidden = false; }

async function stream(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Unavailable"); }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onEvent(JSON.parse(line)); }
  }
}

function replay() {
  const run = recent?.runs?.[0];
  if (!run || playing) return;
  setMode("replay", run.earlier ? "Replay · contract v2 run on Monad Testnet" : "Replay of a real run on Monad Testnet");
  session({ claim: run.claim ?? "a public SciFact claim", caseRef: run.caseRef, run, live: false });
}
async function runLive() {
  if (playing) return;
  const pool = claims.filter(c => c.expected === nextLive), pick = pool[Math.floor(Math.random() * pool.length)] ?? claims[0];
  if (!pick) return;
  nextLive = nextLive === "found" ? "missed" : "found";
  setMode("live", "Live on Monad Testnet");
  document.querySelector(".term-wrap").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  await session({ claim: pick.claim, caseRef: pick.caseRef, live: true });
  status = await getJson("/api/status").catch(() => status);
}

// The numbers band, recomputed from the live assessment so the page and the tools agree.
async function numbers(profileRef) {
  const [a, b] = await Promise.all([mcp("lemma_assess", { profileRef, scenarioRef: FALLBACK }), mcp("lemma_assess", { profileRef, scenarioRef: OWN })]).catch(() => [null, null]);
  const best = a?.results?.find(r => r.rank === 1);
  if (best) {
    const direct = best.expectedSaving + best.cReuse;
    $("nSaved").textContent = `${pct(best.expectedSaving / direct)} less`; $("nCost").textContent = usd(best.cReuse); $("nFallback").textContent = usd(direct);
  }
  const own = b?.results?.find(r => r.rank === 1);
  if (own) { $("nOwn").textContent = usd(own.expectedSaving + own.cReuse, 4); $("nOwnCost").textContent = usd(own.cReuse, 4); }
}

(async () => {
  $("cmd").textContent = `claude mcp add --transport http lemmax ${location.origin}/mcp`;
  $("copy").addEventListener("click", async e => {
    try { await navigator.clipboard.writeText($("cmd").textContent); e.currentTarget.textContent = "Copied"; }
    catch { const r = document.createRange(); r.selectNodeContents($("cmd")); getSelection().removeAllRanges(); getSelection().addRange(r); }
  });
  $("replay").addEventListener("click", replay);
  $("runLive").addEventListener("click", runLive);
  const [s, r, c, o] = await Promise.allSettled([getJson("/api/status"), getJson("/api/recent"), getJson("/api/claims"), mcp("lemma_list_offers")]);
  status = s.status === "fulfilled" ? s.value : null;
  recent = r.status === "fulfilled" ? r.value : null;
  claims = c.status === "fulfilled" ? c.value.claims : [];
  if (recent?.explorer) explorer = recent.explorer;
  if (status?.contractLink) { $("contractPill").href = status.contractLink; $("footContract").href = status.contractLink; }
  if (status?.today && status.today.buysLeft === 0) { $("runLive").disabled = true; $("runNote").textContent = "Today's live runs are used up. The replay and the tools still work."; }
  const tf = o.status === "fulfilled" ? o.value.offers.find(x => x.method !== "bm25") : null;
  if (tf) $("nHits").textContent = `${Math.round(tf.observedHitRate * tf.measuredCases)} of ${tf.measuredCases}`;
  if (o.status === "fulfilled") numbers(o.value.profileRef);
  // Start the replay once the terminal is on screen.
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); replay(); } }, { threshold: 0.25 });
  io.observe(term);
})();
