// LemmaX public page. Everything shown comes from this server's API: the last settled runs,
// the live status, and the event stream of a purchase or a refused attempt. Words live in
// COPY so they can change without touching the logic.
const COPY = {
  lead: "Each search your agent buys settles on Monad by its result, and the record it leaves decides which bill its wallet signs next.",
  sub: "A hit earns the provider the price, a miss credits it back, and the checker's fee is the same either way; the guard reads that record before the wallet signs again.",
  hit: "Hit. The provider earns the search price in this settlement.",
  miss: "Miss. The search price is credited back to your agent.",
  misleadLede: "A prompt-injected agent may try to pay the wrong party. Here are three attempts against this agent's wallet.",
  tricks: [
    { kind: "redirect_payment", title: "Send the money elsewhere", hint: "The guard approves the bill, then the agent changes who gets paid." },
    { kind: "flagged_checker", title: "Pay the checker caught overcharging", hint: "The bill names Checker B, flagged on the public record." },
    { kind: "skip_guard", title: "Skip the guard", hint: "The agent goes straight to its wallet." },
  ],
  holds: [
    ["What the agent signs", "One USDC authorization for the exact total, to the settlement contract, with the hash of the whole bill as its nonce. LemmaX pays the MON gas; the search starts once Monad marks the payment Verified."],
    ["How a verdict splits the money", "In one settlement on Monad: the provider earns the 0.005 USDC price on a hit, and the price is credited back to the agent on a miss. Running and checking charges are capped and published in the settlement event."],
    ["What the checker earns", "The 0.0008 USDC the rulebook sets, for a hit or a miss, and nothing if it stays silent. The auditor files anything above that against the checker. LemmaX runs the checkers today."],
    ["If no verdict arrives", "After the deadline anyone can credit the whole 0.008 USDC back to the agent. Contract v3 pays credit to the owner's wallet inside a settlement once it reaches 0.01 USDC."],
    ["What the wallet signs next", "Only a bill the guard approved after reading the public record: the auditor has seen the last settlement, and no party on the bill carries a blocking finding."],
  ],
  limits: "Scope: LemmaX runs both checkers today, and the rulebook names who holds each key. The auditor checks payments against the rules, not result quality. A refund needs a known right answer, so today's paid search runs over a public benchmark.",
  connectBody: "Six read-only tools: compare the search offers and their odds, preview a search, read a source and check any attempt against the public record. A paid attempt adds the refund and the onchain record.",
  foot: "Test USDC on Monad Testnet. Checker B is a canary LemmaX runs: it overcharges on purpose so you can watch the record flag it.",
  offline: "The purchase desk is offline right now. The last run and the record still work.",
};
const REASONS = {
  evaluator_flagged: "The public record flags this checker for charging above the published price list.",
  issuer_flagged: "The public record flags the issuer of this bill.",
  index_stale: "The public record is behind the chain, so the guard will not approve yet.",
  index_behind_settlement: "The public record has not caught up with the last settlement, so the guard waits.",
  off_terms: "The bill departs from the published terms.",
  off_profile: "The bill's deadlines are not a published profile.",
  operator_income: "The bill pays LemmaX more than the published charge.",
};
const STAGES = ["Proposed", "Voted", "Finalized", "Verified"];
const NODES = ["agent", "guard", "wallet", "monad", "checker"];
const ROLE = { provider: "Provider", "LemmaX (execution)": "LemmaX", checker: "Checker", "buyer (returned)": "Back to your agent" };

const $ = id => document.getElementById(id);
const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let claims = [], kind = "found", pick = { found: 0, missed: 0 }, status = null, recent = null, busy = false, chipAt = null, timers = [];

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v; else if (k.startsWith("on")) node.addEventListener(k.slice(2), v); else node.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : String(kid));
  return node;
}
const fill = (node, ...kids) => { node.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false)); return node; };
const usdc = v => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(4) : String(v); };
const short = x => x ? `${x.slice(0, 6)}…${x.slice(-4)}` : "";
const msText = v => `${Math.round(Number(v)).toLocaleString("en-US")} ms`;
const ago = sec => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(sec)));
  if (s < 60) return `${s} s ago`; if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return `${Math.floor(s / 86400)} d ago`;
};
const explorer = () => recent?.explorer ?? "https://testnet.monadvision.com";
const txAnchor = (hash, label = `tx ${short(hash)}`) => h("a", { href: `${explorer()}/tx/${hash}`, target: "_blank", rel: "noopener" }, `${label} ↗`);
const later = (fn, ms) => timers.push(setTimeout(fn, reduced.matches ? 0 : ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

// Theme: stored choice, else the system's.
function applyTheme(theme) {
  root.dataset.theme = theme;
  $("theme").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  document.querySelector('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#0B0B0D" : "#FAFAF8");
}
let storedTheme = null;
try { storedTheme = localStorage.getItem("lemmax-theme"); } catch {}
applyTheme(storedTheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("theme").addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next); try { localStorage.setItem("lemmax-theme", next); } catch {}
  if (chipAt) moveChip(chipAt);
});

// Static words.
$("lead").textContent = COPY.lead; $("sub").textContent = COPY.sub;
$("misleadLede").textContent = COPY.misleadLede; $("limits").textContent = COPY.limits;
$("connectBody").textContent = COPY.connectBody; $("footNote").textContent = COPY.foot;
fill($("holds"), COPY.holds.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
const origin = location.origin;
$("mcpHero").textContent = `claude mcp add --transport http lemmax ${origin}/mcp`;
$("mcpUrl").textContent = `${origin}/mcp`;
$("recordUrl").textContent = `${origin}/api/record?q=`;
$("how").addEventListener("click", () => {
  const open = $("headline").classList.toggle("open");
  $("how").setAttribute("aria-expanded", String(open)); $("how").textContent = open ? "Less" : "How";
});
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const text = $(button.dataset.copy).textContent;
  try { await navigator.clipboard.writeText(text); } catch {
    const area = h("textarea", { style: "position:fixed;opacity:0" }); area.value = text; document.body.append(area); area.select();
    try { document.execCommand("copy"); } catch {} area.remove();
  }
  button.textContent = "Copied"; button.classList.add("done");
  setTimeout(() => { button.textContent = "Copy"; button.classList.remove("done"); }, 1400);
});

// The window's head line belongs to the mode: the buy view keeps its own between visits.
const head = { buy: { title: "Last run", tag: null, meta: "" } };
function setHead(title, tag, meta) {
  head.buy = { title, tag, meta };
  if (!$("stage").querySelector('[data-view="buy"]').hidden) showHead("buy");
}
function showHead(mode) {
  const c = recent?.counts ?? {};
  const h0 = mode === "buy" ? head.buy
    : mode === "mislead" ? { title: "Mislead it", tag: null, meta: `${c.refused ?? 0} refused · ${c.signedOutsidePolicy ?? 0} signed` }
    : { title: "Public record", tag: null, meta: status?.settlement ? `contract ${short(status.settlement)}` : "" };
  $("stageTitle").textContent = h0.title;
  $("stageTag").hidden = !h0.tag; $("stageTag").textContent = h0.tag ?? "";
  $("stageMeta").textContent = h0.meta ?? "";
}
const setMeta = meta => setHead(head.buy.title, head.buy.tag, meta);

// The dock: one window, three modes (tabs pattern, arrow keys move between them).
const tabs = [...document.querySelectorAll(".dock [role=tab]")];
function setMode(mode, focus = false) {
  for (const tab of tabs) {
    const on = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  for (const view of document.querySelectorAll("[data-view]")) view.hidden = view.dataset.view !== mode;
  if (mode === "buy") requestAnimationFrame(() => { if (chipAt) moveChip(chipAt); });
  showHead(mode);
  if (mode === "record") renderRecord();
  if (mode === "mislead" && !$("billRows").childElementCount) idleBill();
}
for (const tab of tabs) {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
  tab.addEventListener("keydown", event => {
    const i = tabs.indexOf(tab), step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) { event.preventDefault(); setMode(tabs[(i + step + tabs.length) % tabs.length].dataset.mode, true); }
  });
}
document.querySelector("[data-goto=record]").addEventListener("click", event => {
  event.preventDefault(); setMode("record"); $("stage").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
});

// Claims: a toggle between ones the search finds and ones it misses.
function chosen() { const list = claims.filter(c => c.expected === kind); return list[pick[kind] % Math.max(1, list.length)]; }
function renderClaim() {
  for (const b of document.querySelectorAll(".toggle [data-kind]")) b.setAttribute("aria-checked", String(b.dataset.kind === kind));
  const claim = chosen();
  $("claimText").textContent = claim?.claim ?? "";
  const offer = status?.offers?.find(o => o.used);
  fill($("odds"), offer ? [h("b", {}, `${offer.successes} of ${offer.cases}`), " public claims found a right source", kind === "missed" ? " · this one is a known miss" : ""] : []);
  $("buyBtn").disabled = busy || !claim || !status;
}
for (const b of document.querySelectorAll(".toggle [data-kind]")) b.addEventListener("click", () => { kind = b.dataset.kind; renderClaim(); });
$("shuffle").addEventListener("click", () => { pick[kind] += 1; renderClaim(); });

// The flow line and its chip.
const nodeEl = name => $("flow").querySelector(`[data-node="${name}"]`);
function setNode(name, state, text = "") {
  const li = nodeEl(name); li.classList.remove("on", "done", "refused"); if (state) li.classList.add(state);
  li.querySelector("small").textContent = text;
}
function moveChip(name, look) {
  const chip = $("chip"), li = nodeEl(name);
  if (!li) return;
  chipAt = name;
  chip.style.setProperty("--x", `${li.offsetLeft + li.offsetWidth / 2}px`);
  chip.classList.add("show");
  if (look) { chip.classList.toggle("back", look === "back"); chip.classList.toggle("stop", look === "stop"); }
}
function chipText(text, look = "") { const chip = $("chip"); chip.textContent = text; chip.classList.toggle("back", look === "back"); chip.classList.toggle("stop", look === "stop"); }
function setStage(step, value, skipped = false) {
  const cell = $("stages").querySelector(`[data-stage="${step}"]`);
  if (!cell) return;
  cell.classList.toggle("hit", !skipped && value != null); cell.classList.toggle("skip", skipped);
  cell.querySelector("em").textContent = skipped ? "not seen" : value != null ? msText(value) : "";
}
function resetStage() {
  clearTimers();
  NODES.forEach(n => setNode(n, null)); STAGES.forEach(s => setStage(s, null));
  $("chip").classList.remove("show", "back", "stop"); chipText(`${status?.price?.held ?? "0.008"} USDC`); chipAt = null;
  fill($("stageTotal")); fill($("lines")); fill($("caption")); fill($("verdict")); $("verdict").className = "verdict";
  fill($("txLink")); fill($("details")); $("details").hidden = true; $("detailsBtn").setAttribute("aria-expanded", "false"); $("detailsBtn").textContent = "Details +";
}
// Commit states from a recorded timeline. A state Monad did not report (a block can skip
// Voted; the polling fallback sees only Finalized) is drawn as not seen, never invented.
function showTimeline(timeline, { animate }) {
  const at = Object.fromEntries((timeline ?? []).map(x => [x.step, x.ms]));
  const verified = at.Verified;
  for (const step of STAGES) {
    const run = () => setStage(step, at[step] ?? null, at[step] == null && verified != null);
    animate && at[step] != null ? later(run, Math.min(at[step], 4000)) : run();
  }
  const total = () => fill($("stageTotal"), verified != null ? ["Verified on Monad ", h("b", {}, msText(verified)), " after the payment was sent"] : []);
  animate ? later(total, Math.min(verified ?? 0, 4000)) : total();
}

// The receipt: one line per party, the price back on a miss, the details behind a toggle.
function receiptLines(run) {
  const hit = run.outcome === "success";
  const rows = (run.payouts ?? []).map(p => ({ ...p, label: ROLE[p.role] ?? p.role }));
  if (!hit && !rows.some(r => r.role === "provider")) rows.unshift({ role: "provider", label: "Provider", earned: "0", paidNow: "0", zero: true });
  return rows.sort((a, b) => ["provider", "LemmaX (execution)", "checker", "buyer (returned)"].indexOf(a.role) - ["provider", "LemmaX (execution)", "checker", "buyer (returned)"].indexOf(b.role));
}
// Digits roll up to the settled amount, so the receipt reads as printed just now.
function rollUp(node, value, duration = 700) {
  const start = performance.now();
  const step = now => {
    const k = Math.min(1, (now - start) / duration), eased = 1 - (1 - k) ** 3;
    node.textContent = `+${(k < 1 ? value * eased : value).toFixed(4)}`;
    if (k < 1) requestAnimationFrame(step);
  };
  node.textContent = "+0.0000"; requestAnimationFrame(step);
}
function renderReceipt(run, { animate = false } = {}) {
  const hit = run.outcome === "success";
  $("verdict").className = `verdict ${hit ? "hit" : "miss"}`;
  $("verdict").textContent = `${hit ? "Hit" : "Miss"} · claim ${run.caseRef}`;
  const rows = receiptLines(run);
  fill($("lines"), rows.map(r => {
    const back = r.role === "buyer (returned)", zero = r.zero || Number(r.earned) === 0;
    const cls = zero ? "zero" : back ? "back" : r.role === "provider" ? "in" : "";
    const sub = r.name && r.name !== r.label && r.role === "checker" ? r.name : Number(r.paidNow) > 0 ? `${usdc(r.paidNow)} paid to its wallet now` : !zero && !run.earlier ? "credited" : null;
    const amt = h("span", { class: "amt" }, `${zero ? "" : "+"}${usdc(r.earned)}`);
    const li = h("li", { class: cls }, h("span", { class: "who" }, r.label, sub ? h("small", {}, sub) : null), amt);
    if (animate && !zero && !reduced.matches) { li.classList.add("flash"); rollUp(amt, Number(r.earned)); }
    return li;
  }));
  $("caption").textContent = hit ? COPY.hit : COPY.miss;
  fill($("txLink"), run.settleTx ? txAnchor(run.settleTx) : null);
  const credit = (run.payouts ?? []).filter(p => p.creditOwed && Number(p.creditOwed) > 0).map(p => `${ROLE[p.role] ?? p.role} ${usdc(p.creditOwed)}`).join(", ");
  const paid = (run.payouts ?? []).filter(p => Number(p.paidNow) > 0).map(p => `${ROLE[p.role] ?? p.role} ${usdc(p.paidNow)}`).join(", ");
  const rows2 = [
    ["Attempt", run.attemptId ? short(run.attemptId) : null], ["Funding", run.fundTx ? txAnchor(run.fundTx, short(run.fundTx)) : null],
    ["Settlement", run.settleTx ? txAnchor(run.settleTx, short(run.settleTx)) : null], ["Block", run.block ? Number(run.block).toLocaleString("en-US") : null],
    ["Checker", run.checker], ["Paid out now", paid || (run.earlier ? "none (contract v2 kept credit)" : "none, each owner below 0.01 USDC")],
    ["Credit owed", credit || null], ["Contract", run.earlier ? `v2 ${short(run.contract)}` : status ? `v3 ${short(status.settlement)}` : null],
    ["Rulebook", status?.rulebook ? `${status.rulebook.ref} ${short(status.rulebook.hash)}` : null],
  ].filter(([, v]) => v != null);
  fill($("details"), rows2.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
  if (animate && !hit) {
    const back = rows.find(r => r.role === "buyer (returned)");
    if (back) { chipText(`+${usdc(back.earned)} USDC`, "back"); moveChip("checker"); later(() => moveChip("agent"), 120); }
  }
}
$("detailsBtn").addEventListener("click", () => {
  const open = $("details").hidden; $("details").hidden = !open;
  $("detailsBtn").setAttribute("aria-expanded", String(open)); $("detailsBtn").textContent = open ? "Hide details" : "Details +";
});

// Replay a settled run in the window, labelled as a replay.
function showRun(run, { animate = true, label = "Last run" } = {}) {
  if (!run || busy) return;
  resetStage();
  setHead(label, run.earlier ? "contract v2" : "replay", run.at ? `settled ${ago(run.at)}` : "settled on Monad Testnet");
  const steps = [["agent", "signed"], ["guard", "approved"], ["wallet", "signed"], ["monad", null], ["checker", run.outcome === "success" ? "hit" : "miss"]];
  const verified = run.timeline?.find(x => x.step === "Verified")?.ms;
  let delay = 0;
  for (const [node, text] of steps) {
    later(() => {
      moveChip(node);
      setNode(node, "done", node === "monad" ? (verified != null ? msText(verified) : "verified") : text);
      if (node === "monad") showTimeline(run.timeline, { animate });
      if (node === "checker") renderReceipt(run, { animate });
    }, animate ? delay : 0);
    delay += node === "monad" ? Math.min(verified ?? 600, 4000) + 250 : 260;
  }
  if (!run.timeline) later(() => fill($("stageTotal"), "Commit states were not recorded for this earlier run."), animate ? delay : 0);
}

// The overcharging checker can only be refused once the public record flags it.
function renderScenarios() {
  const b = $("scenarios").querySelector('[data-trick="flagged_checker"]');
  if (!b || trickBusy) return;
  const ready = Boolean(status?.checkerB?.flagged);
  b.disabled = !ready;
  b.querySelector("small").textContent = ready ? COPY.tricks.find(t => t.kind === "flagged_checker").hint : "Opens once the public record flags Checker B.";
}
function renderWallet() {
  if (!status?.wallet) { fill($("walletFact")); return; }
  const w = status.wallet;
  const who = w.mode === "privy" ? "Agent wallet (Privy)" : "Agent wallet (local signer)";
  fill($("walletFact"), `${who} `, h("b", {}, `${usdc(w.usdc)} USDC · ${Number(w.mon)} MON`), Number(w.mon) === 0 ? " · never paid gas" : "");
  $("walletLayer").textContent = w.mode === "privy" ? "Privy policy" : "Wallet policy (local)";
}
function renderLive() {
  const run = recent?.runs?.[0], parts = [];
  if (run && !run.earlier && run.at) parts.push(h("span", {}, "Last search settled ", h("b", {}, ago(run.at))), h("span", {}, `Block ${Number(run.block).toLocaleString("en-US")}`));
  else if (run) parts.push(h("span", {}, "Last settled run: contract v2 on Monad Testnet"));
  if (status?.wallet) parts.push(h("span", {}, `Agent wallet holds ${Number(status.wallet.mon)} MON`));
  if (status?.today) parts.push(h("span", {}, `${status.today.buysLeft} searches left today`));
  fill($("liveLine"), parts);
}

// A live purchase: each event moves the chip only when it arrives.
async function stream(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `Request failed (${res.status})`); }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); if (line) onEvent(JSON.parse(line)); }
  }
}
function note(text, error = false) { $("buyNote").textContent = text ?? ""; $("buyNote").classList.toggle("error", error); }
$("buyBtn").addEventListener("click", async () => {
  const claim = chosen();
  if (!claim || busy) return;
  busy = true; renderClaim(); setMode("buy"); resetStage(); note("");
  if (matchMedia("(max-width: 980px)").matches) $("stage").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
  setHead("Your search", "live", "");
  $("buyBtn").textContent = "Buying…";
  let relayAt = null, failed = false;
  try {
    await stream("/api/buy", { caseRef: claim.caseRef }, e => {
      if (e.type === "error") { failed = true; note(e.message, true); if (chipAt) chipText("stopped", "stop"); return; }
      if (e.type === "waiting") { setMeta(`waiting for the public record · block ${e.progressBlock ?? "?"} of ${e.target}`); return; }
      if (e.type === "stage") {
        if (e.step === "Relayed") { relayAt = e.t; setNode("monad", "on", "sent"); moveChip("monad"); }
        else setStage(e.step, relayAt != null ? e.t - relayAt : e.t);
        return;
      }
      if (e.type === "receipt") {
        setNode("checker", "done", e.outcome === "success" ? "hit" : "miss");
        renderReceipt(e, { animate: true });
        setMeta(`settled in ${(e.t / 1000).toFixed(1)} s`);
        recent = { ...recent, runs: [e, ...(recent?.runs?.filter(r => !r.earlier) ?? [])].slice(0, 5), fromEarlierContract: false };
        renderLive();
        return;
      }
      if (e.type !== "step") return;
      if (e.id === "quote") { setNode("agent", "done", "bill"); chipText(`${e.held} USDC`); moveChip("agent"); }
      if (e.id === "guard") {
        if (e.approved) { setNode("guard", "done", msText(e.t)); moveChip("guard"); }
        else { setNode("guard", "refused", "refused"); moveChip("guard"); chipText("refused", "stop"); note(e.reasons.map(r => REASONS[r] ?? r).join(" "), true); }
      }
      if (e.id === "wallet") {
        if (e.signed) { setNode("wallet", "done", msText(e.t)); moveChip("wallet"); }
        else { setNode("wallet", "refused", "refused"); moveChip("wallet"); chipText("refused", "stop"); note(e.message, true); }
      }
      if (e.id === "locked") { showTimeline(e.timeline, { animate: false }); const v = e.timeline?.find(x => x.step === "Verified"); setNode("monad", "done", v ? msText(v.ms) : "verified"); }
      if (e.id === "checked") { setNode("checker", "on", "checking"); moveChip("checker"); }
      if (e.id === "settled") setMeta("settled, waiting for the record");
      if (e.id === "recorded") setMeta(`recorded by the ${e.auditor === "envio" ? "Envio" : "local"} auditor`);
    });
  } catch (error) { failed = true; note(error.message, true); }
  busy = false; $("buyBtn").textContent = "Buy one search"; renderClaim();
  refreshStatus();
  if (!failed && status?.today) note(`${status.today.buysLeft} searches left today on this page.`);
});

// Mislead it: three attempts to make the wallet pay outside the bill.
let trickBusy = false;
fill($("scenarios"), COPY.tricks.map(t => h("button", { type: "button", "data-trick": t.kind, "aria-selected": "false", onclick: () => runTrick(t) }, t.title, h("small", {}, t.hint))));
function idleBill() {
  fill($("billRows"), h("dt", {}, "Bill"), h("dd", { class: "muted" }, "Pick an attempt on the left."));
  for (const li of $("layers").children) { li.className = ""; li.querySelector("b").textContent = ""; li.querySelector("em").textContent = ""; }
  fill($("why")); fill($("moved"));
}
function setLayer(name, state, text, t) {
  const li = $("layers").querySelector(`[data-layer="${name}"]`);
  li.className = state; li.querySelector("b").textContent = text; li.querySelector("em").textContent = t != null ? msText(t) : "";
}
const walletWords = message => {
  const text = String(message ?? "").replace(/^Policy refused:\s*/i, "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}` : "Refused.";
};
async function runTrick(t) {
  if (trickBusy) return;
  trickBusy = true;
  for (const b of $("scenarios").children) { b.setAttribute("aria-selected", String(b.dataset.trick === t.kind)); b.disabled = true; }
  idleBill(); fill($("billRows"), h("dt", {}, "Bill"), h("dd", { class: "muted" }, "Asking for a bill…"));
  let guardRefused = false, payTo = null;
  try {
    await stream("/api/trick", { kind: t.kind }, e => {
      if (e.type === "error") { fill($("why"), e.message); return; }
      if (e.type === "done") {
        const held = e.result?.held;
        setLayer("contract", "skip", "not reached");
        fill($("moved"), held ? "Nothing signed. 0 USDC moved." : h("span", { class: "to-bad" }, "Signed outside policy."));
        return;
      }
      if (e.id === "quote" && e.bill) {
        payTo = e.bill.payTo;
        fill($("billRows"), h("dt", {}, "Amount"), h("dd", {}, `${e.bill.amount} USDC`), h("dt", {}, "Pay to"), h("dd", { id: "payTo" }, `${short(payTo)} (settlement contract)`),
          h("dt", {}, "Checker"), h("dd", {}, e.bill.checker));
      }
      if (e.id === "guard") {
        if (e.skipped) setLayer("guard", "skip", "skipped", null);
        else if (e.approved) setLayer("guard", "pass", "passed", e.t);
        else { guardRefused = true; setLayer("guard", "stop", "refused", e.t); fill($("why"), (e.reasons ?? []).map(r => REASONS[r] ?? r).join(" ")); }
      }
      if (e.id === "tamper") fill($("payTo"), h("s", {}, short(payTo)), " → ", h("span", { class: "to-bad" }, short(e.to)));
      if (e.id === "wallet") {
        if (e.refused) {
          if (guardRefused) setLayer("wallet", "pass", "refused too", e.t);
          else { setLayer("wallet", "stop", "refused", e.t); fill($("why"), walletWords(e.message)); }
        } else setLayer("wallet", "stop", "signed", e.t);
      }
    });
  } catch (error) { fill($("why"), error.message); }
  trickBusy = false;
  for (const b of $("scenarios").children) b.disabled = false;
  renderScenarios(); refreshRecent();
}

// The record: counts, the last runs as sentences, and a lookup.
function renderRecord() {
  const c = recent?.counts ?? {};
  const stat = (n, label) => h("div", {}, h("b", {}, n ?? 0), h("span", {}, label));
  fill($("counts"), h("p", { class: "window" }, "Through this page, on Monad Testnet"),
    h("div", { class: "stats" }, stat(c.settled, "settled"), stat(c.missed, "refunded on a miss"), stat(c.refused, "attempts refused"), stat(c.signedOutsidePolicy, "signed outside policy")));
  const runs = recent?.runs ?? [];
  fill($("events"), runs.length ? runs.map(run => {
    const hit = run.outcome === "success";
    const key = (run.payouts ?? []).find(p => p.role === (hit ? "provider" : "buyer (returned)"));
    return h("li", {}, h("button", { type: "button", onclick: () => { setMode("buy"); showRun(run, { label: "Recorded run" }); } },
      h("span", { class: `pill ${hit ? "hit" : "miss"}` }, hit ? "hit" : "miss"), "Settled",
      key ? h("span", { class: "pill" }, `${hit ? "Provider" : "Back"} +${usdc(key.earned)}`) : null,
      run.checker && run.checker !== "Checker" ? h("span", { class: "pill" }, run.checker) : null,
      run.settleTx ? h("span", { class: "pill" }, `tx ${short(run.settleTx)}`) : null,
      h("span", { class: "when" }, run.earlier ? "contract v2" : ago(run.at))));
  }) : h("li", { class: "empty" }, "No runs yet."));
}
const PARTY = { connector: "Provider", executor: "LemmaX", evaluator: "Checker", buyer: "Back to the agent" };
$("lookup").addEventListener("submit", async event => {
  event.preventDefault();
  const q = $("q").value.trim();
  fill($("recordOut"), h("p", { class: "muted small" }, "Checking…"));
  try {
    const r = await getJson(`/api/record?q=${encodeURIComponent(q)}`);
    if (!r.found) return fill($("recordOut"), h("div", { class: "found small" }, r.summary ?? "Not found."));
    const blocking = (r.verdicts ?? []).filter(v => v.severity !== "informational");
    const alloc = r.allocation ? Object.entries(PARTY).filter(([k]) => r.allocation[k] && BigInt(r.allocation[k]) > 0n)
      .map(([k, label]) => [h("dt", {}, label), h("dd", {}, usdc(Number(r.allocation[k]) / 1e6))]) : [];
    fill($("recordOut"), h("div", { class: "found" },
      h("p", { class: `mono small ${blocking.length ? "bad" : "ok"}` }, blocking.length ? `${blocking.length} rule finding(s): ${blocking.map(v => v.code).join(", ")}` : "Follows the published rules"),
      h("dl", { class: "details mono small" }, h("dt", {}, "State"), h("dd", {}, String(r.state).replace("_", " ")), alloc,
        r.links?.fund ? [h("dt", {}, "Funding"), h("dd", {}, h("a", { href: r.links.fund, target: "_blank", rel: "noopener" }, `${short(r.fundTx)} ↗`))] : null,
        r.links?.outcome ? [h("dt", {}, "Outcome"), h("dd", {}, h("a", { href: r.links.outcome, target: "_blank", rel: "noopener" }, `${short(r.outcomeTx)} ↗`))] : null,
        h("dt", {}, "Checked by"), h("dd", {}, `${r.auditor === "envio" ? "Envio" : "local"} auditor, rulebook ${short(r.rulebookHash)}`))));
  } catch (error) { fill($("recordOut"), h("p", { class: "note error" }, error.message)); }
});

// Data: status and recent runs, refreshed while the page is open.
async function refreshStatus() {
  try { status = await getJson("/api/status"); } catch { status = null; }
  if (!status) note(COPY.offline);
  if (status?.settlement) $("contractAddr").textContent = status.settlement;
  $("held").textContent = status ? `${status.price.held} USDC held · no MON needed` : "";
  renderWallet(); renderLive(); renderClaim(); renderScenarios();
}
async function refreshRecent() {
  try { recent = await getJson("/api/recent"); } catch { recent = recent ?? null; }
  if (recent?.contract && !$("contractAddr").textContent) $("contractAddr").textContent = recent.contract;
  renderLive();
  const mode = tabs.find(t => t.getAttribute("aria-selected") === "true")?.dataset.mode ?? "buy";
  if (mode === "record") renderRecord();
  if (mode !== "buy") showHead(mode);
}
addEventListener("resize", () => { if (chipAt) moveChip(chipAt); });

(async () => {
  idleBill();
  const [claimRes] = await Promise.allSettled([getJson("/api/claims"), refreshStatus(), refreshRecent()]);
  claims = claimRes.status === "fulfilled" ? claimRes.value.claims : [];
  renderClaim();
  const last = recent?.runs?.[0];
  if (last) showRun(last, { label: "Last run" });
  else fill($("lines"), h("li", { class: "empty" }, "No settled run yet. Buy the first one."));
  setInterval(() => { if (!busy) { refreshStatus(); refreshRecent(); } }, 30000);
  setInterval(renderLive, 15000);
})();
