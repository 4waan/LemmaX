import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { walletRefusal } from "./buyer-wallet.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/).max(4096);

// The agent's own wallet as an MCP server, kept apart from the seller's tools. The agent can
// ask it to sign a LemmaX bill, nothing else: the buyer's guard first checks the bill against
// the published rules and the public auditor, then the wallet policy signs only that bill's
// digest. A refusal is an ordinary answer naming who refused and why, so the agent can act on
// it. The signature is a USDC authorization the agent hands to lemma_fund_attempt.
export function createWalletMcpServer({ guard, signer, mode, describe }) {
  const server = new McpServer({ name: "lemmax-wallet", version: VERSION });
  let lastSettlementBlock = null;
  const run = action => async args => {
    try {
      const result = await action(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const reason = error instanceof TypeError || error instanceof RangeError ? error.message : null;
      return { isError: true, content: [{ type: "text", text: reason ? `Request rejected: ${reason}` : "The wallet is unavailable right now." }] };
    }
  };
  server.registerTool("wallet_status", {
    description: "The agent wallet's address, USDC and MON balances, and the one thing its policy lets it sign.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, run(async () => ({ ...await describe(), lastSettlementBlock })));
  server.registerTool("wallet_sign_bill", {
    description: "Sign the USDC authorization for a bill from lemma_quote_attempt. The buyer's guard checks the issuer's signature, the published terms and the public auditor's record first; the wallet policy then signs only that bill's digest, paid to the settlement contract. Pass the quote, issuerSignature and buyerAuthorization exactly as lemma_quote_attempt returned them. Pass lastSettlementBlock from your previous lemma_deliver_attempt so the auditor must have recorded it.",
    inputSchema: z.object({
      quote: z.record(z.string(), z.unknown()),
      issuerSignature: hex,
      buyerAuthorization: z.object({ domain: z.record(z.string(), z.unknown()), types: z.record(z.string(), z.unknown()).optional(),
        primaryType: z.string().optional(), message: z.record(z.string(), z.unknown()) }).passthrough(),
      lastSettlementBlock: z.string().regex(/^(0|[1-9][0-9]{0,19})$/).optional(),
    }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, run(async ({ quote, issuerSignature, buyerAuthorization, lastSettlementBlock: block }) => {
    if (block && (lastSettlementBlock === null || BigInt(block) > BigInt(lastSettlementBlock))) lastSettlementBlock = block;
    const approval = await guard.approve({ quote, issuerSignature, buyerAuthorization, indexedThrough: lastSettlementBlock });
    if (!approval.approved) return { signed: false, refusedBy: "guard", reasons: approval.reasons };
    try {
      const signature = await signer.signFundingAuthorization(buyerAuthorization);
      const m = buyerAuthorization.message;
      return { signed: true, attemptId: quote.attemptId, billDigest: approval.digest, signature, validAfter: String(m.validAfter), validBefore: String(m.validBefore),
        value: String(m.value), to: String(m.to), signedBy: mode === "privy" ? "Privy server wallet policy" : "local signer holding the Privy policy rule",
        next: "Pass attemptId, validAfter, validBefore and signature to lemma_fund_attempt." };
    } catch (error) {
      const refusal = walletRefusal(error, mode);
      return { signed: false, refusedBy: refusal.by, reasons: [refusal.message] };
    } finally {
      // The digest is approved for this one signature only.
      await guard.release(approval).catch(() => {});
    }
  }));
  return server;
}
