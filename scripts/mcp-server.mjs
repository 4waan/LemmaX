import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSciFact, createSciFactIndex } from "../src/scifact.mjs";
import { createPublicDirectory } from "../src/directory.mjs";
import { createMcpServer } from "../src/mcp.mjs";
import { loadRetrievalReport } from "./verify-retrieval.mjs";

try {
  const report = loadRetrievalReport();
  const data = loadSciFact(process.env.LEMMAX_SCIFACT_DIR);
  const directory = createPublicDirectory({ report, data, index: createSciFactIndex(data) });
  await createMcpServer(directory).connect(new StdioServerTransport());
} catch {
  console.error("LemmaX could not start. Check installed dependencies and the prepared public benchmark directory.");
  process.exitCode = 1;
}
