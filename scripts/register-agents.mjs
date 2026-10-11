import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWalletClient, formatUnits, getAddress, http, keccak256, parseEventLogs, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { connectMonad, envAddress, gasLimitFor } from "../src/monad.mjs";
import { ERC8004, IDENTITY_ABI, LEMMAX_AGENTS, dataUri, registrationFile, registrationMetadata } from "../src/erc8004.mjs";
import { evaluatorBAccount } from "../src/keys.mjs";
import { RULEBOOK, RULEBOOK_HASH } from "../src/rulebook.mjs";

// Registers LemmaX's four ERC-8004 agents on Monad Testnet. The deployer registers each
// with its metadata, writes the registration file (which names the new agent ID) as an
// onchain data URI, then transfers the agent to its role key. Dry run by default;
// LEMMAX_REGISTER_BROADCAST=1 sends. Contract v3 must already be deployed: the deployer's
// first transaction is reserved for it, and the files name its address.
const OUTPUT = fileURLToPath(new URL("../deployments/erc8004-agents.json", import.meta.url));
const HEADROOM_BPS = 1000;

function key(env, name) {
  try { return privateKeyToAccount(env[name]); } catch { throw new TypeError(`${name} is missing or is not a private key`); }
}

async function main(env) {
  const rpcUrl = env.LEMMAX_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
  const { chain, publicClient } = await connectMonad({ network: "testnet", rpcUrl });
  const deployer = key(env, "DEPLOYER_PRIVATE_KEY");
  const owners = { deployer: deployer.address, evaluator: key(env, "EVALUATOR_PRIVATE_KEY").address, evaluatorB: evaluatorBAccount(env).address,
    provider: envAddress(env, "LEMMA_PROVIDER_ADDRESS") };
  const settlement = envAddress(env, "LEMMAX_SETTLEMENT_ADDRESS", { optional: true }) ?? "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7";
  const rulebook = { ref: RULEBOOK.rulebookRef, hash: RULEBOOK_HASH };
  const auditor = env.LEMMAX_AUDITOR_URL ?? null;
  const done = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : { schemaVersion: "erc8004-agents/v1", identityRegistry: ERC8004.identity, agents: {} };
  const deployed = (await publicClient.getCode({ address: settlement }))?.length > 2;
  const balance = await publicClient.getBalance({ address: deployer.address });
  const plan = Object.keys(LEMMAX_AGENTS).map(role => ({ role, name: LEMMAX_AGENTS[role].name, owner: owners[LEMMAX_AGENTS[role].owner],
    registered: done.agents[role]?.agentId ?? null, fileBytes: JSON.stringify(registrationFile({ role, agentId: 0, settlement, rulebook, auditor })).length }));
  if (env.LEMMAX_REGISTER_BROADCAST !== "1") {
    return { dryRun: true, settlement, settlementDeployed: deployed, deployer: deployer.address, deployerMon: formatUnits(balance, 18), auditor, plan,
      next: deployed ? "Set LEMMAX_REGISTER_BROADCAST=1 to register." : "Deploy contract v3 first; the deployer's next transaction is reserved for it." };
  }
  if (!deployed) throw new TypeError("Contract v3 is not deployed at the settlement address yet");
  const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl, { retryCount: 0 }) });
  // Estimate first: Monad charges the gas limit, and a mined revert pays it in full.
  async function send(functionName, args) {
    const call = { address: ERC8004.identity, abi: IDENTITY_ABI, functionName, args, account: deployer };
    const gas = gasLimitFor(await publicClient.estimateContractGas(call), HEADROOM_BPS);
    const hash = await wallet.writeContract({ ...call, chain, gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw Object.assign(new Error(`${functionName} reverted`), { hash });
    return { hash, receipt, gasUsed: receipt.gasUsed.toString() };
  }
  for (const { role, owner } of plan) {
    const entry = done.agents[role] ?? {};
    if (entry.agentId === undefined) {
      const registered = await send("register", ["", registrationMetadata({ role, settlement, rulebook })]);
      const [log] = parseEventLogs({ abi: IDENTITY_ABI, eventName: "Registered", logs: registered.receipt.logs });
      Object.assign(entry, { agentId: log.args.agentId.toString(), registerTx: registered.hash, registerGas: registered.gasUsed });
      done.agents[role] = entry; writeFileSync(OUTPUT, JSON.stringify(done, null, 2) + "\n");
    }
    if (!entry.uriTx) {
      const file = registrationFile({ role, agentId: entry.agentId, settlement, rulebook, auditor });
      const uri = dataUri(file);
      const written = await send("setAgentURI", [BigInt(entry.agentId), uri]);
      Object.assign(entry, { uriTx: written.hash, uriGas: written.gasUsed, fileSha: keccak256(stringToBytes(uri)) });
      mkdirSync(fileURLToPath(new URL("../registrations/", import.meta.url)), { recursive: true });
      writeFileSync(fileURLToPath(new URL(`../registrations/${role}.json`, import.meta.url)), JSON.stringify(file, null, 2) + "\n");
      writeFileSync(OUTPUT, JSON.stringify(done, null, 2) + "\n");
    }
    if (owner !== deployer.address && !entry.transferTx) {
      const moved = await send("transferFrom", [deployer.address, getAddress(owner), BigInt(entry.agentId)]);
      Object.assign(entry, { transferTx: moved.hash });
    }
    entry.owner = getAddress(await publicClient.readContract({ address: ERC8004.identity, abi: IDENTITY_ABI, functionName: "ownerOf", args: [BigInt(entry.agentId)] }));
    if (entry.owner !== getAddress(owner)) throw new Error(`Agent ${role} is owned by an unexpected address`);
    writeFileSync(OUTPUT, JSON.stringify(done, null, 2) + "\n");
  }
  return { dryRun: false, ...done };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await main(process.env), null, 2) + "\n"); }
  catch (error) { console.error(`Registration stopped: ${error.shortMessage ?? error.message}${error.hash ? ` (transaction ${error.hash})` : ""}`); process.exitCode = 1; }
}
