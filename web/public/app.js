// One action, one result. The scene moves only when the real event arrives.
const $ = id => document.getElementById(id);
const moment = $("moment");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let claims = [], status = null, explorer = "https://testnet.monadvision.com", next = "missed", busy = false;

const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const show = (...kids) => { moment.replaceChildren(...kids); for (const k of kids) k.classList.add("rise"); };
const button = (label, cls, onClick) => { const b = node("button", cls, label); b.type = "button"; b.addEventListener("click", onClick); return b; };
const txLink = hash => { const a = node("a", "", "View transaction"); a.href = `${explorer}/tx/${hash}`; a.target = "_blank"; a.rel = "noopener"; return a; };
async function getJson(url) { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Something went wrong"); return j; }
async function stream(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? "Something went wrong"); }
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

// The scene.
const coin = $("coin"), out = $("pathOut"), back = $("pathBack");
const P = { agent: 0, monad: 0.5, search: 1 };
let chain = Promise.resolve(), coinAt = { path: out, t: 0 };
function place(path, t) { const p = path.getPointAtLength(path.getTotalLength() * t); coin.setAttribute("transform", `translate(${p.x} ${p.y})`); coinAt = { path, t }; }
function glide(path, from, to, ms = 700) {
  chain = chain.then(() => new Promise(done => {
    coin.classList.add("live");
    if (reduced) { place(path, to); return done(); }
    const start = performance.now();
    const frame = now => {
      const k = Math.min(1, (now - start) / ms), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      place(path, from + (to - from) * e);
      k < 1 ? requestAnimationFrame(frame) : done();
    };
    requestAnimationFrame(frame);
  }));
  return chain;
}
const then = fn => { chain = chain.then(fn); return chain; };
const tick = (id, text, cls = "") => then(() => { const t = $(id); t.textContent = text; t.setAttribute("class", `tick ${cls}`); });
const mark = (id, cls) => then(() => { $(id).classList.remove("on", "good", "bad", "pulse"); if (cls) { void $(id).getBBox(); $(id).classList.add(cls); } });
function resetScene() {
  chain = Promise.resolve();
  for (const id of ["tAgent", "tMonad", "tSearch"]) $(id).textContent = "";
  for (const id of ["nAgent", "nMonad", "nSearch"]) $(id).classList.remove("on", "good", "bad", "pulse");
  coin.classList.remove("bad", "live");
  place(out, P.agent);
}

// Buying.
function idle() { resetScene(); const go = button(next === "missed" ? "Buy a search" : "Now buy one that works", "go", buy); go.disabled = !status || !claims.length; show(go); }
async function buy() {
  if (busy) return;
  const pool = claims.filter(c => c.expected === next), claim = pool[Math.floor(Math.random() * pool.length)];
  if (!claim) return;
  busy = true; resetScene(); mark("nAgent", "on");
  const line = node("p", "status", "Paying");
  show(line);
  let relayAt = 0, result = null, error = null, toMonad = null, toSearchDone = Promise.resolve();
  try {
    await stream("/api/buy", { caseRef: claim.caseRef }, e => {
      if (e.type === "error") error = e.message;
      if (e.type === "step" && e.id === "guard" && !e.approved) error = "The wallet refused this bill.";
      if (e.type === "step" && e.id === "wallet" && e.signed) { toMonad = glide(out, P.agent, P.monad, 800); line.textContent = "Settling on Monad"; }
      if (e.type === "stage" && e.step === "Relayed") relayAt = e.t;
      if (e.type === "stage" && e.step === "Verified") { const s = ((e.t - relayAt) / 1000).toFixed(1); mark("nMonad", "pulse"); tick("tMonad", `${s} s`); line.textContent = `Final on Monad in ${s} s`; }
      if (e.type === "step" && e.id === "checked") { line.textContent = "Searching"; toSearchDone = glide(out, P.monad, P.search, 700); }
      if (e.type === "receipt") result = e;
    });
  } catch (err) { error = err.message; }
  busy = false;
  if (!result) { await chain; show(node("p", "small", error ?? "Something went wrong."), button("Try again", "ghost", idle)); return; }
  const hit = result.outcome === "success";
  const backAmt = Number(result.payouts?.find(p => p.role === "buyer (returned)")?.earned ?? 0).toFixed(4);
  const fade = () => then(() => coin.classList.remove("live"));
  if (hit) { await toSearchDone; fade(); mark("nSearch", "good"); tick("tSearch", "Found"); }
  else { tick("tSearch", "Nothing"); await glide(back, 0, 1, 1100); fade(); mark("nAgent", "good"); tick("tAgent", `+${backAmt}`, "back"); }
  await chain;
  const note = node("p", "small", hit ? "The search found a source, so the provider got paid. " : "Nothing found, so the price came back. ");
  if (result.settleTx) note.append(txLink(result.settleTx));
  next = hit ? "missed" : "found";
  show(note, button(next === "missed" ? "Buy another" : "Now buy one that works", "go", buy));
  status = await getJson("/api/status").catch(() => status);
}

// Tricks: the coin never leaves the agent.
const TRICKS = [
  { kind: "redirect_payment", label: "Change who gets paid", why: "It only pays the contract." },
  { kind: "skip_guard", label: "Skip the safety check", why: "It only signs approved bills." },
  { kind: "flagged_checker", label: "Pay a checker caught cheating", why: "The record shows that checker cheated." },
];
function tricks(result) {
  resetScene();
  const picks = node("div", "picks");
  for (const t of TRICKS) if (t.kind !== "flagged_checker" || status?.checkerB?.flagged) picks.append(button(t.label, "", () => trick(t, picks)));
  show(...(result ?? [node("p", "small", "Try to make the wallet pay the wrong party.")]), picks);
}
async function trick(t, picks) {
  if (busy) return;
  busy = true; resetScene();
  for (const b of picks.querySelectorAll("button")) b.disabled = true;
  glide(out, P.agent, 0.18, 380);
  let held = false, error = null;
  try { await stream("/api/trick", { kind: t.kind }, e => { if (e.type === "done") held = Boolean(e.result?.held); if (e.type === "error") error = e.message; }); }
  catch (err) { error = err.message; }
  busy = false;
  then(() => coin.classList.add("bad")); mark("nAgent", "bad"); tick("tAgent", "Refused"); await glide(out, 0.18, P.agent, 380);
  tricks(held ? [node("p", "small", `Refused. ${t.why} Nothing moved.`)] : [node("p", "small", error ?? "Something went wrong.")]);
  $("nAgent").classList.add("bad"); $("tAgent").textContent = "Refused";
}

function connect() {
  resetScene();
  const cmd = node("code", "cmd", `claude mcp add --transport http lemmax ${location.origin}/mcp`);
  const copy = button("Copy", "ghost", async () => {
    try { await navigator.clipboard.writeText(cmd.textContent); copy.textContent = "Copied"; }
    catch { const r = document.createRange(); r.selectNodeContents(cmd); getSelection().removeAllRanges(); getSelection().addRange(r); }
  });
  show(node("p", "small", "One line gives your agent LemmaX."), cmd, copy);
}

// Three things to do here; the side links show the other two.
const MODES = { buy: ["Buy a search", idle], trick: ["Try to trick it", () => tricks()], connect: ["Connect an agent", connect] };
function setMode(m) {
  if (busy) return;
  MODES[m][1]();
  const others = Object.keys(MODES).filter(k => k !== m);
  for (const [i, id] of ["sideA", "sideB"].entries()) { $(id).textContent = MODES[others[i]][0]; $(id).dataset.mode = others[i]; }
}
for (const id of ["sideA", "sideB"]) $(id).addEventListener("click", e => setMode(e.currentTarget.dataset.mode));

(async () => {
  const [c, s, r] = await Promise.allSettled([getJson("/api/claims"), getJson("/api/status"), getJson("/api/recent")]);
  claims = c.status === "fulfilled" ? c.value.claims : [];
  status = s.status === "fulfilled" ? s.value : null;
  if (r.status === "fulfilled" && r.value.explorer) explorer = r.value.explorer;
  setMode("buy");
})();
