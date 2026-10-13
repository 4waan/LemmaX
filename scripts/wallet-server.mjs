import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAuditClient } from "../src/audit.mjs";
import { buyerMandate } from "../src/buyer-wallet.mjs";
import { createBuyerGuard } from "../src/guard.mjs";
import { createLocalAudit } from "../src/local-audit.mjs";
import { connectMonad, envAddress } from "../src/monad.mjs";
import { createSettlementClient } from "../src/settlement.mjs";
import { DEMO_TERMS, formatUsdc } from "../src/terms.mjs";
import { createWalletMcpServer } from "../src/wallet-mcp.mjs";

const V3 = Object.freeze({ address: "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7", fromBlock: "70137467" });
const BALANCE = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];

// The agent's wallet as its own MCP server, for an agent that buys from LemmaX. Run it beside
// the LemmaX server in the same MCP client. It reads the settlement contract and the public
// auditor (Envio when LEMMAX_AUDITOR_URL is set, else the same rules over Monad logs), and
// signs through the Privy wallet when configured, else the local rehearsal of its policy.
// Stdout carries only protocol messages; keys are never printed.
export async function createWalletServer(env = process.env) {
  const network = env.LEMMAX_MONAD_NETWORK ?? "testnet";
  const rpcUrl = env.LEMMAX_MONAD_RPC_URL ?? (network === "testnet" ? "https://testnet-rpc.monad.xyz" : undefined);
  const { chain, publicClient } = await connectMonad({ network, rpcUrl, pollingInterval: 300 });
  const address = envAddress(env, "LEMMAX_SETTLEMENT_ADDRESS", { optional: true }) ?? V3.address;
  const settlement = createSettlementClient({ publicClient, address, gasHeadroomBps: 1000 });
  const token = await settlement.asset();
  const total = BigInt(DEMO_TERMS.principal) + BigInt(DEMO_TERMS.executionCap) + BigInt(DEMO_TERMS.evaluationCap);
  const mandate = await buyerMandate({ env, chainId: chain.id, usdc: token.address, settlement: settlement.address, maxValue: total });
  const auditor = env.LEMMAX_AUDITOR_URL ? "envio" : "local";
  const audit = env.LEMMAX_AUDITOR_URL ? createAuditClient({ url: env.LEMMAX_AUDITOR_URL, publicClient })
    : createLocalAudit({ publicClient, address: settlement.address, fromBlock: BigInt(env.LEMMAX_SETTLEMENT_FROM_BLOCK ?? (address === V3.address ? V3.fromBlock : "0")) });
  if (auditor === "local") audit.snapshot().catch(() => {});
  const chainTime = async () => (await publicClient.getBlock()).timestamp.toString();
  const guard = createBuyerGuard({ buyer: mandate.signer.address, domain: { chainId: String(chain.id), verifyingContract: settlement.address },
    approvedIssuer: () => settlement.approvedIssuer(), chainTime, audit, conditionSets: mandate.conditionSets, setId: mandate.setId,
    auditRequired: env.LEMMAX_AUDIT_REQUIRED !== "false" });
  const describe = async () => {
    const [usdc, mon] = await Promise.all([
      publicClient.readContract({ address: token.address, abi: BALANCE, functionName: "balanceOf", args: [mandate.signer.address] }),
      publicClient.getBalance({ address: mandate.signer.address })]);
    return { address: mandate.signer.address, network: `Monad ${network}`, chainId: chain.id, usdc: formatUsdc(usdc), mon: (Number(mon) / 1e18).toString(),
      wallet: mandate.mode === "privy" ? "Privy server wallet" : "local signer holding the Privy policy rule", auditor,
      policy: `Signs one thing: a USDC ReceiveWithAuthorization on chain ${chain.id} to the settlement contract ${settlement.address}, at most ${formatUsdc(total)} USDC, whose nonce is a bill digest the guard approved.` };
  };
  return { server: createWalletMcpServer({ guard, signer: mandate.signer, mode: mandate.mode, describe }), mode: mandate.mode, auditor, network, settlement: settlement.address };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const wallet = await createWalletServer();
    await wallet.server.connect(new StdioServerTransport());
    console.error(`LemmaX wallet MCP on Monad ${wallet.network}: ${wallet.mode === "privy" ? "Privy" : "local"} policy, ${wallet.auditor} auditor, settlement ${wallet.settlement}`);
  } catch (error) {
    const reason = error instanceof TypeError || error instanceof RangeError ? ` ${error.message}.` : "";
    console.error(`LemmaX wallet could not start.${reason}`);
    process.exitCode = 1;
  }
}
