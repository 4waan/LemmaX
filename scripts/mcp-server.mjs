import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSciFact, createSciFactIndex } from "../src/scifact.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { createOperatorDesk, operatorConfigured } from "../src/operator.mjs";
import { createAuditClient } from "../src/audit.mjs";
import { connectMonad } from "../src/monad.mjs";
import { loadRetrievalReport } from "./verify-retrieval.mjs";

// One entry point. Read-only by default; with the operator's settlement contract and issuer
// key configured it also serves quote, fund and status. Stdout carries only protocol
// messages, so the mode line goes to stderr.
try {
  const report = loadRetrievalReport();
  const data = loadSciFact(process.env.LEMMAX_SCIFACT_DIR);
  const directory = createPublicDirectory({ report, data, index: createSciFactIndex(data) });
  const operator = operatorConfigured(process.env) ? await createOperatorDesk({ env: process.env, data }) : null;
  // The auditor check needs only its public GraphQL URL and a Monad RPC for the chain head.
  const audit = process.env.LEMMAX_AUDITOR_URL ? createAuditClient({ url: process.env.LEMMAX_AUDITOR_URL,
    publicClient: (await connectMonad({ network: process.env.LEMMAX_MONAD_NETWORK ?? "testnet", rpcUrl: process.env.LEMMAX_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz" })).publicClient }) : null;
  await createMcpServer(directory, operator?.desk ?? null, { audit }).connect(new StdioServerTransport());
  console.error([operator ? `LemmaX MCP: operator mode on Monad ${operator.network}, settlement ${operator.settlement}` : "LemmaX MCP: read-only public benchmark",
    audit ? ", with the public auditor" : ""].join(""));
} catch (error) {
  const reason = error instanceof TypeError || error instanceof RangeError ? ` ${error.message}.` : "";
  console.error(`LemmaX could not start.${reason} Check installed dependencies, the prepared public benchmark directory and any operator settings.`);
  process.exitCode = 1;
}
