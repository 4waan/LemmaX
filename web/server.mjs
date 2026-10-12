import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createPublicDirectory } from "../src/directory.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { createSciFactIndex, loadSciFact } from "../src/scifact.mjs";
import { loadRetrievalReport } from "../scripts/verify-retrieval.mjs";
import { TRICKS, createLimiter, createLiveDesk } from "./live.mjs";

// LemmaX's public page and its small API. Purchases and tricks stream newline-delimited
// JSON events so the page can show each step the moment it happens. /mcp serves the
// read-only LemmaX tools over Streamable HTTP, so any MCP client can connect with a URL.
const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" };

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "cache-control": "no-store", ...SECURITY, ...headers });
  res.end(text);
}
async function readJson(req, limit = 4096) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new RangeError("Request too large"); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new TypeError("Send JSON"); }
}
// What a visitor may see of a failure: our own validation messages, nothing internal.
const publicError = error => error instanceof TypeError || error instanceof RangeError ? error.message : "Something went wrong on our side. Nothing was charged beyond what the receipt shows.";

// The socket is the visitor boundary unless a trusted reverse proxy replaces this header.
// Enable forwarded addresses only when the server is reachable exclusively through it.
export function visitorAddress(req, { trustProxy = false } = {}) {
  const remote = String(req.socket?.remoteAddress ?? "");
  if (!trustProxy) return remote;
  return String(req.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim() || remote;
}

export async function startServer({ env = process.env, port = Number(env.PORT ?? 8080), log = console.error } = {}) {
  const report = loadRetrievalReport();
  const data = loadSciFact(env.LEMMAX_SCIFACT_DIR);
  const directory = createPublicDirectory({ report, data, index: createSciFactIndex(data) });
  const live = await createLiveDesk({ env, data, report });
  const buyLimit = createLimiter({ limit: Number(env.LEMMAX_LIVE_BUYS_PER_VISITOR ?? 3), windowMs: 10 * 60000 });
  const trickLimit = createLimiter({ limit: Number(env.LEMMAX_LIVE_TRICKS_PER_VISITOR ?? 12), windowMs: 10 * 60000 });
  const visitorOf = req => live.visitorHash(visitorAddress(req, { trustProxy: env.LEMMAX_TRUST_PROXY === "true" }));

  async function stream(req, res, run) {
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", ...SECURITY });
    const emit = event => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
    try { const result = await run(emit); emit({ type: "done", result }); }
    catch (error) { log(`run failed: ${error?.shortMessage ?? error?.message}`); emit({ type: "error", message: publicError(error) }); }
    res.end();
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/healthz") return send(res, 200, { ok: true });
      if (url.pathname === "/api/status" && req.method === "GET") return send(res, 200, await live.status());
      if (url.pathname === "/api/claims" && req.method === "GET") return send(res, 200, { claims: live.claims });
      if (url.pathname === "/api/record" && req.method === "GET") return send(res, 200, await live.record(url.searchParams.get("q") ?? ""));
      if (url.pathname === "/api/buy" && req.method === "POST") {
        const visitor = visitorOf(req), allowed = buyLimit(visitor);
        if (!allowed.ok) return send(res, 429, { error: `Three purchases per visitor every ten minutes. Try again in ${Math.ceil(allowed.retryInMs / 60000)} min.` });
        const { caseRef } = await readJson(req);
        return stream(req, res, emit => live.buy({ caseRef: String(caseRef ?? ""), visitor }, emit));
      }
      if (url.pathname === "/api/trick" && req.method === "POST") {
        const visitor = visitorOf(req), allowed = trickLimit(visitor);
        if (!allowed.ok) return send(res, 429, { error: `Too many tries. Try again in ${Math.ceil(allowed.retryInMs / 60000)} min.` });
        const { kind } = await readJson(req);
        if (!TRICKS.includes(kind)) return send(res, 400, { error: "Unknown trick" });
        return stream(req, res, emit => live.trick({ kind, visitor }, emit));
      }
      if (url.pathname === "/mcp") {
        // Stateless: a fresh read-only server per request, so no session state is held.
        if (req.method !== "POST") return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Use POST" }, id: null });
        const body = await readJson(req, 65536);
        const mcp = createMcpServer(directory, null, { audit: live.audit });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => { transport.close(); mcp.close(); });
        await mcp.connect(transport);
        return transport.handleRequest(req, res, body);
      }
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
      const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
      const file = join(PUBLIC, path);
      if (!file.startsWith(PUBLIC) || !existsSync(file)) return send(res, 404, "Not found");
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "public, max-age=300", ...SECURITY });
      return res.end(readFileSync(file));
    } catch (error) {
      if (!res.headersSent) send(res, error instanceof TypeError || error instanceof RangeError ? 400 : 500, { error: publicError(error) });
      else res.end();
    }
  });
  await new Promise(resolve => server.listen(port, resolve));
  log(`LemmaX live page on :${server.address().port} (wallet ${live.mode}, auditor ${live.auditor}, settlement ${live.settlement})`);
  return { server, live, port: server.address().port };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch(error => {
    console.error(`LemmaX live page could not start: ${error instanceof TypeError || error instanceof RangeError ? error.message : error?.shortMessage ?? "startup failed"}`);
    process.exitCode = 1;
  });
}
