import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWalletClient, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connectMonad, envAddress, gasLimitFor } from "../src/monad.mjs";
import { readSettlementLogs } from "../src/reconcile.mjs";
import { ERC8004, REPUTATION_ABI } from "../src/erc8004.mjs";
import { attemptsFromLogs, buildFeedback, countedFromFeedback } from "../src/reputation.mjs";
import { decodeFeedbackUri } from "../indexer/src/shared/feedback.mjs";

// Operator command for LemmaX's batched ERC-8004 feedback. It previews by default and sends
// only with --publish. Inputs are public: settlement events from the contract and LemmaX
// feedback already on the Reputation registry (so no attempt is counted twice).
const AGENTS = fileURLToPath(new URL("../deployments/erc8004-agents.json", import.meta.url));

function key(env, name) {
  try { return privateKeyToAccount(env[name]); } catch { throw new TypeError(`${name} is missing or is not a private key`); }
}

async function main(env, publish) {
  const rpcUrl = env.LEMMAX_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
  const { chain, publicClient } = await connectMonad({ network: "testnet", rpcUrl });
  const agents = JSON.parse(readFileSync(AGENTS, "utf8")).agents;
  const settlement = envAddress(env, "LEMMAX_SETTLEMENT_ADDRESS", { optional: true }) ?? "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7";
  if (!/^[0-9]+$/.test(env.LEMMAX_SETTLEMENT_FROM_BLOCK ?? "")) throw new TypeError("Set LEMMAX_SETTLEMENT_FROM_BLOCK to the v3 deployment block");
  const fromBlock = BigInt(env.LEMMAX_SETTLEMENT_FROM_BLOCK), toBlock = await publicClient.getBlockNumber();
  const attempts = attemptsFromLogs(await readSettlementLogs({ publicClient, address: settlement, fromBlock, toBlock, maxBlockRange: 100n }));
  const evaluator = key(env, "EVALUATOR_PRIVATE_KEY"), issuer = key(env, "FACILITATOR_PRIVATE_KEY");
  const ours = new Set([evaluator.address, issuer.address]);
  const prior = [];
  for (let start = fromBlock; start <= toBlock; start += 100n) {
    const end = start + 99n < toBlock ? start + 99n : toBlock;
    const logs = await publicClient.getContractEvents({ address: ERC8004.reputation, abi: REPUTATION_ABI, eventName: "NewFeedback", fromBlock: start, toBlock: end });
    for (const log of logs) if (ours.has(getAddress(log.args.clientAddress))) prior.push(decodeFeedbackUri(log.args.feedbackURI)?.file);
  }
  const counted = countedFromFeedback(prior);
  const window = { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() };
  const provider = { agentId: agents.provider.agentId, role: "provider", payee: agents.provider.owner };
  const planned = [
    buildFeedback({ kind: "acceptance", giver: evaluator.address, subject: provider, attempts, counted, window }),
    ...["evaluator", "evaluatorB"].map(role => buildFeedback({ kind: "conformance", giver: issuer.address,
      subject: { agentId: agents[role].agentId, role, signer: agents[role].owner }, attempts, counted, window })),
  ].filter(Boolean);
  if (!publish) return { preview: true, settledAttempts: attempts.length, feedback: planned.map(f => f.line), next: planned.length ? "Rerun with --publish to send." : "Nothing new to publish." };
  const sent = [];
  for (const f of planned) {
    const account = f.giver === evaluator.address ? evaluator : issuer;
    const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { retryCount: 0 }) });
    const call = { address: ERC8004.reputation, abi: REPUTATION_ABI, functionName: "giveFeedback", account,
      args: [f.agentId, f.value, f.valueDecimals, f.tag1, f.tag2, f.endpoint, f.feedbackURI, f.feedbackHash] };
    const gas = gasLimitFor(await publicClient.estimateContractGas(call), 1000);
    const hash = await wallet.writeContract({ ...call, chain, gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw Object.assign(new Error("giveFeedback reverted"), { hash });
    sent.push({ line: f.line, transactionHash: hash, gasUsed: receipt.gasUsed.toString() });
  }
  return { preview: false, sent };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await main(process.env, process.argv.includes("--publish")), null, 2) + "\n"); }
  catch (error) { console.error(`Reputation stopped: ${error.shortMessage ?? error.message}${error.hash ? ` (transaction ${error.hash})` : ""}`); process.exitCode = 1; }
}
