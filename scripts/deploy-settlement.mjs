import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, encodeDeployData, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compileSettlement } from "./compile-settlement.mjs";
import { CONFIRMATION_STAGES, connectMonad, gasLimitFor, waitForStage } from "../src/monad.mjs";
import { SETTLEMENT_ABI } from "../src/settlement.mjs";
import { digest } from "../src/retrieval.mjs";

const SOURCES = ["contracts/AttemptSettlement.sol", "scripts/compile-settlement.mjs", "scripts/deploy-settlement.mjs", "src/monad.mjs", "src/settlement.mjs"];

// Constructor-set immutables (issuer, cached EIP-712 domain) differ per deployment.
// Zero them in both runtime codes so the deployed code can be compared with this build.
export function maskImmutables(code, references) {
  const bytes = Buffer.from(code.slice(2), "hex");
  for (const ranges of Object.values(references)) for (const { start, length } of ranges) bytes.fill(0, start, start + length);
  return bytes;
}

export async function planDeployment({ publicClient, from, artifact, issuer, gasHeadroomBps }) {
  if (JSON.stringify(artifact.abi) !== JSON.stringify(SETTLEMENT_ABI)) throw new Error("Committed ABI differs from this build");
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [getAddress(issuer)] });
  const gasEstimate = await publicClient.estimateGas({ account: getAddress(from), data });
  const gasLimit = gasLimitFor(gasEstimate, gasHeadroomBps);
  const { maxFeePerGas } = await publicClient.estimateFeesPerGas();
  // Monad bills the limit, so limit times max fee bounds the deployment charge.
  return { gasEstimate, gasLimit, maxFeePerGas, maxCharge: gasLimit * maxFeePerGas };
}

export async function deploySettlement({ publicClient, wallet, artifact, issuer, gasHeadroomBps, stage, pollMs, timeoutMs }) {
  const approvedIssuer = getAddress(issuer);
  const plan = await planDeployment({ publicClient, from: wallet.account.address, artifact, issuer: approvedIssuer, gasHeadroomBps });
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [approvedIssuer], gas: plan.gasLimit });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment transaction failed");
  const confirmation = await waitForStage(publicClient, receipt, stage, { pollMs, timeoutMs });
  const address = getAddress(receipt.contractAddress);
  const runtime = await publicClient.getCode({ address });
  const masked = maskImmutables(runtime, artifact.immutableReferences);
  if (!masked.equals(maskImmutables(artifact.deployedBytecode, artifact.immutableReferences))) throw new Error("Deployed runtime code differs from this build");
  const read = functionName => publicClient.readContract({ address, abi: SETTLEMENT_ABI, functionName });
  const [onchainIssuer, domain] = await Promise.all([read("approvedIssuer"), read("eip712Domain")]);
  const chainId = await publicClient.getChainId();
  if (getAddress(onchainIssuer) !== approvedIssuer || domain[1] !== "LemmaXAttemptSettlement" || domain[2] !== "1"
    || domain[3] !== BigInt(chainId) || getAddress(domain[4]) !== address) throw new Error("Deployed authority or signing domain differs from the request");
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  return { schemaVersion: "settlement-deployment/v1", chainId, address, approvedIssuer, deployer: wallet.account.address,
    eip712: { name: domain[1], version: domain[2] }, transactionHash: hash, blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash, blockTimestamp: block.timestamp.toString(),
    confirmation: { stage, finalizedHead: confirmation.finalizedHead?.toString() ?? null },
    gasEstimate: plan.gasEstimate.toString(), gasLimit: plan.gasLimit.toString(), gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(), compiler: artifact.compiler, evmVersion: artifact.evmVersion,
    maskedRuntimeSha256: digest(masked), abiSha256: digest(JSON.stringify(SETTLEMENT_ABI)),
    codeSha256: Object.fromEntries(SOURCES.map(path => [path, digest(readFileSync(new URL(`../${path}`, import.meta.url)))])) };
}

function account(key) {
  try { return privateKeyToAccount(key); } catch { throw new TypeError("LEMMAX_DEPLOYER_KEY is not a valid private key"); }
}

// Dry run by default: estimate and print the bounded charge, send nothing.
// Broadcasting requires LEMMAX_DEPLOY_BROADCAST=1 plus key, stage and output directory.
async function main(env) {
  const headroom = Number(env.LEMMAX_GAS_HEADROOM_BPS);
  const { network, chain, publicClient } = await connectMonad({ network: env.LEMMAX_MONAD_NETWORK, rpcUrl: env.LEMMAX_MONAD_RPC_URL,
    allowMainnet: env.LEMMAX_ALLOW_MAINNET === "1" });
  const issuer = getAddress(env.LEMMAX_QUOTE_ISSUER ?? "");
  const deployer = env.LEMMAX_DEPLOYER_KEY ? account(env.LEMMAX_DEPLOYER_KEY) : null;
  const artifact = compileSettlement();
  const plan = await planDeployment({ publicClient, from: deployer?.address ?? issuer, artifact, issuer, gasHeadroomBps: headroom });
  const summary = { network, chainId: chain.id, approvedIssuer: issuer, gasEstimate: plan.gasEstimate.toString(), gasLimit: plan.gasLimit.toString(),
    maxFeePerGas: plan.maxFeePerGas.toString(), maxChargeWei: plan.maxCharge.toString() };
  if (env.LEMMAX_DEPLOY_BROADCAST !== "1") return { dryRun: true, ...summary };
  if (!deployer) throw new TypeError("Broadcasting requires LEMMAX_DEPLOYER_KEY");
  if (!CONFIRMATION_STAGES.includes(env.LEMMAX_CONFIRMATION_STAGE)) throw new TypeError("Set LEMMAX_CONFIRMATION_STAGE to included, finalized or verified");
  const output = env.LEMMAX_DEPLOYMENT_OUTPUT;
  if (!output) throw new TypeError("Set LEMMAX_DEPLOYMENT_OUTPUT to an ignored directory");
  const wallet = createWalletClient({ account: deployer, chain, transport: http(env.LEMMAX_MONAD_RPC_URL, { retryCount: 0 }) });
  const manifest = { network, ...await deploySettlement({ publicClient, wallet, artifact, issuer, gasHeadroomBps: headroom,
    stage: env.LEMMAX_CONFIRMATION_STAGE, pollMs: 500, timeoutMs: 120000 }) };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `AttemptSettlement.${network}.json`), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(output, "AttemptSettlement.standard-input.json"), JSON.stringify(artifact.standardInput, null, 2) + "\n");
  return { dryRun: false, ...manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.env), null, 2)); }
  catch (error) { console.error(`Deployment stopped: ${error instanceof TypeError || error instanceof RangeError ? error.message : error.shortMessage ?? error.message}`); process.exitCode = 1; }
}
