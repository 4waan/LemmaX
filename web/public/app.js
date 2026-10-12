// LemmaX public page: buy a search, try to trick the wallet, check the public record.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const secs = ms => ms === undefined || ms === null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

// Theme: light by default, remembered per browser.
const root = document.documentElement;
const applyTheme = t => { root.dataset.theme = t; $("#theme").textContent = t === "dark" ? "Light" : "Dark"; };
try { applyTheme(localStorage.getItem("lemmax.theme") ?? "light"); } catch { applyTheme("light"); }
$("#theme").onclick = () => { const t = root.dataset.theme === "dark" ? "light" : "dark"; applyTheme(t); try { localStorage.setItem("lemmax.theme", t); } catch {} };

$("#mcpLine").textContent = `claude mcp add --transport http lemmax ${location.origin}/mcp`;

function pop(html, ms = 6000) { const p = $("#pop"); p.innerHTML = html; p.hidden = false; clearTimeout(pop.t); pop.t = setTimeout(() => { p.hidden = true; }, ms); }

async function status() {
  try {
    const s = await (await fetch("/api/status")).json();
    const used = s.offers?.find(o => o.used);
    $("#facts").innerHTML = [
      used ? `<span class="chip">Odds <b>${used.successes} in ${used.cases}</b> found a right source</span>` : "",
      `<span class="chip">Agent wallet <b>${esc(s.wallet.usdc)} USDC</b> · <b>${Number(s.wallet.mon) === 0 ? "0 MON" : `${esc(s.wallet.mon)} MON`}</b></span>`,
      `<span class="chip">Public record <b>${s.auditor === "envio" ? "Envio" : "local check"}</b>${s.freshness?.lagBlocks !== null && s.freshness?.lagBlocks !== undefined ? ` · ${s.freshness.lagBlocks} blocks behind` : ""}</span>`,
      `<span class="chip">Wallet rules <b>${s.wallet.mode === "privy" ? "Privy" : "rehearsal"}</b></span>`,
      `<a class="chip" href="${esc(s.contractLink)}" target="_blank" rel="noopener">Contract <b>${short(s.settlement)}</b></a>`].join("");
    $("#held").textContent = `${s.price.held} USDC held, ${s.price.principal} is the search price · ${s.today.buysLeft} left today`;
  } catch { $("#facts").innerHTML = `<span class="chip">Status unavailable</span>`; }
}

async function claims() {
  const { claims } = await (await fetch("/api/claims")).json();
  $("#claims").innerHTML = claims.map((c, i) => `<label class="claim"><input type="radio" name="claim" value="${esc(c.caseRef)}" ${i === 0 ? "checked" : ""}>
    <span>${esc(c.claim)}</span><span class="tag ${c.expected === "missed" ? "miss" : ""}">${c.expected === "missed" ? "search misses this one" : "search finds a source"}</span></label>`).join("");
  $("#buyBtn").disabled = false;
}

// Reads a newline-delimited JSON event stream and hands each event to `on`.
async function run(path, body, on) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${response.status}`); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (line.trim()) on(JSON.parse(line)); }
  }
}

function row(list, id, cls, html, t) {
  let li = list.querySelector(`[data-id="${id}"]`);
  if (!li) { li = document.createElement("li"); li.dataset.id = id; list.append(li); }
  li.className = cls; li.innerHTML = `<span class="dot"></span><span>${html}</span><span class="t">${secs(t)}</span>`;
  return li;
}
const reasons = r => r.map(x => ({ evaluator_flagged: "the checker has a blocking finding on the public record", issuer_flagged: "the issuer has a blocking finding",
  off_terms: "the bill differs from the published terms", off_profile: "the deadlines match no published profile", index_stale: "the public record is behind the chain",
  index_unavailable: "the public record is unreachable", index_behind_settlement: "the public record has not caught up with the last settlement",
  authorization_mismatch: "what the agent would sign differs from the bill", issuer_signature_or_expiry: "the bill is not signed by LemmaX or has expired",
  wrong_buyer: "the bill is for another buyer", unregistered_or_self_evaluator: "the checker is not on the published roster", rulebook_changed: "the rulebook changed" }[x] ?? x)).join("; ");

function walletLine(e) {
  if (e.signed) return ["ok", `Wallet signed, under its rules (${esc(e.by)})`];
  if (e.signedUnexpectedly) return ["no", "The wallet signed. This should not happen; please tell us."];
  return ["no", `Refused by ${esc(e.by)}${e.status ? ` (HTTP ${e.status})` : ""}: ${esc(e.message)}`];
}

$("#buyBtn").onclick = async () => {
  const caseRef = document.querySelector("input[name=claim]:checked")?.value;
  const list = $("#buySteps"); list.innerHTML = ""; $("#receipt").innerHTML = "";
  $("#buyBtn").disabled = true;
  const stages = [];
  try {
    await run("/api/buy", { caseRef }, e => {
      if (e.type === "step" && e.id === "quote") row(list, "quote", "ok", `Bill issued: ${esc(e.held)} USDC held, ${esc(e.price)} for the search, checked by ${esc(e.checker)}`, e.t);
      if (e.type === "step" && e.id === "guard") row(list, "guard", e.approved ? "ok" : "no", e.approved ? "Guard approved the bill against the public record" : `Guard refused: ${reasons(e.reasons)}`, e.t);
      if (e.type === "step" && e.id === "wallet") { const [c, h] = walletLine(e); row(list, "wallet", c, h, e.t); }
      if (e.type === "stage") { stages.push(e); row(list, "stages", "wait", `Locked on Monad <span class="stages">${stages.map(s => `<span class="stage">${esc(s.step)} ${secs(s.t)}</span>`).join("")}</span>`, e.t); }
      if (e.type === "step" && e.id === "locked") row(list, "stages", "ok", `Locked on Monad <span class="stages">${(e.timeline ?? []).map(s => `<span class="stage">${esc(s.step)} ${secs(s.ms)}</span>`).join("")}</span> <a href="${esc(e.link)}" target="_blank" rel="noopener">receipt</a>`, e.t);
      if (e.type === "step" && e.id === "checked") row(list, "checked", e.relevant ? "ok" : "no", e.relevant ? "Checker: a right source came back" : "Checker: no right source in the top five, so the price comes back", e.t);
      if (e.type === "step" && e.id === "settled") row(list, "settled", "ok", `Settled on Monad <a href="${esc(e.link)}" target="_blank" rel="noopener">receipt</a>`, e.t);
      if (e.type === "waiting") row(list, "recorded", "wait", "Public record catching up", null);
      if (e.type === "step" && e.id === "recorded") row(list, "recorded", "ok", `Public record caught up${e.auditor === "envio" ? " (Envio)" : ""}`, e.t);
      if (e.type === "receipt") $("#receipt").innerHTML = `<div class="receipt"><table><tr><th>Who</th><th>Earned here</th><th>Paid out now</th><th>Still owed</th></tr>${e.payouts.map(p =>
        `<tr><td>${esc(p.role)}</td><td class="num">${esc(p.earned)}</td><td class="num ${p.role.startsWith("buyer") ? "back" : "paid"}">${esc(p.paidNow)}</td><td class="num">${esc(p.creditOwed)}</td></tr>`).join("")}</table></div>
        <p class="muted small">Owners are paid in this same transaction once they are owed at least 0.01 USDC (a payout can include earlier credit), so nobody needs MON to collect. Attempt <code>${esc(short(e.attemptId))}</code>.</p>`;
      if (e.type === "error") row(list, "error", "no", esc(e.message), null);
    });
  } catch (error) { row(list, "error", "no", esc(error.message), null); }
  $("#buyBtn").disabled = false; status();
};

document.querySelectorAll("[data-trick]").forEach(button => button.onclick = async () => {
  const list = $("#trickSteps"); list.innerHTML = "";
  document.querySelectorAll("[data-trick]").forEach(b => b.disabled = true);
  try {
    await run("/api/trick", { kind: button.dataset.trick }, e => {
      if (e.type === "step" && e.id === "quote") row(list, "quote", "ok", `A real bill from LemmaX, checked by ${esc(e.checker)}. It will never be sent.`, e.t);
      if (e.type === "step" && e.id === "guard") row(list, "guard", e.skipped ? "no" : e.approved ? "ok" : "no", e.skipped ? "The agent skips its guard and goes straight to the wallet" : e.approved ? "Guard approved this bill" : `Guard refused: ${reasons(e.reasons)}`, e.t);
      if (e.type === "step" && e.id === "tamper") row(list, "tamper", "no", `The agent changes who gets paid, to ${esc(short(e.to))}`, e.t);
      if (e.type === "step" && e.id === "wallet") { const [c, h] = walletLine(e); row(list, "wallet", c, h, e.t); }
      if (e.type === "done") row(list, "done", e.result?.held ? "ok" : "no", e.result?.held ? "Nothing was signed. No money moved." : "Check the steps above.", null);
      if (e.type === "error") row(list, "error", "no", esc(e.message), null);
    });
  } catch (error) { row(list, "error", "no", esc(error.message), null); }
  document.querySelectorAll("[data-trick]").forEach(b => b.disabled = false);
});

$("#lookup").onsubmit = async event => {
  event.preventDefault();
  const out = $("#recordOut"); out.innerHTML = `<p class="muted">Checking…</p>`;
  try {
    const r = await (await fetch(`/api/record?q=${encodeURIComponent($("#q").value.trim())}`)).json();
    if (r.error) throw new Error(r.error);
    if (!r.found) { out.innerHTML = `<p class="muted">${esc(r.summary)}</p>`; return; }
    const a = r.allocation ?? {};
    out.innerHTML = `<p>${esc(r.summary)}</p><div class="receipt"><table><tr><th>Provider</th><th>LemmaX</th><th>Checker</th><th>Back to buyer</th></tr>
      <tr>${["connector", "executor", "evaluator", "buyer"].map(k => `<td class="num">${a[k] !== undefined ? (Number(a[k]) / 1e6).toFixed(4) : "?"}</td>`).join("")}</tr></table></div>
      <p class="small">${(r.verdicts ?? []).map(v => `<span class="chip">${esc(v.code)} · ${esc(v.severity)}</span>`).join(" ") || "No rule findings."}
      ${r.links?.fund ? ` <a href="${esc(r.links.fund)}" target="_blank" rel="noopener">funding</a>` : ""}${r.links?.outcome ? ` · <a href="${esc(r.links.outcome)}" target="_blank" rel="noopener">outcome</a>` : ""}</p>`;
  } catch (error) { out.innerHTML = `<p class="no">${esc(error.message)}</p>`; }
};

document.querySelectorAll(".rail a").forEach(a => a.addEventListener("click", () => { document.querySelectorAll(".rail a").forEach(x => x.classList.remove("on")); a.classList.add("on"); }));
status(); claims(); setInterval(status, 15000);
