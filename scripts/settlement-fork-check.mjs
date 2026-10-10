import assert from "node:assert/strict";
import { domainSeparator, getAddress } from "viem";
import { compileSettlement } from "./compile-settlement.mjs";
import { FIAT_TOKEN_ABI, forkMinter } from "./fork-usdc.mjs";
import { CHECKED_SOURCES, HEADROOM_BPS, connectWhenReady, runLifecycle, sourceHashes, startAnvil } from "./settlement-check.mjs";
import { MONAD_NETWORKS } from "../src/monad.mjs";

// Runs the settlement lifecycle against Circle's deployed USDC on a local fork of Monad
// Testnet. Buyer funds are minted on the fork through USDC's own minter roles, so no
// testnet funds or keys are used and nothing is broadcast to the network.
const IMPLEMENTATION_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";

const forkUrl = process.env.LEMMAX_FORK_RPC_URL;
if (!forkUrl) throw new TypeError("Set LEMMAX_FORK_RPC_URL to a Monad Testnet RPC endpoint");
const node = await startAnvil(["--fork-url", forkUrl]);
try {
  const { chain, publicClient } = await connectWhenReady(node, "testnet");
  const usdc = MONAD_NETWORKS.testnet.usdc;
  const forkBlock = await publicClient.getBlockNumber();
  const read = functionName => publicClient.readContract({ address: usdc, abi: FIAT_TOKEN_ABI, functionName });
  const [name, version, separator] = await Promise.all([read("name"), read("version"), read("DOMAIN_SEPARATOR")]);
  // The buyer signs against the token's own domain; it must match what the client derives.
  assert.equal(domainSeparator({ domain: { name, version, chainId: chain.id, verifyingContract: usdc } }), separator);
  const implementation = getAddress(`0x${(await publicClient.getStorageAt({ address: usdc, slot: IMPLEMENTATION_SLOT })).slice(-40)}`);
  const minter = await forkMinter({ publicClient, chain, rpc: node.rpc, usdc });
  const token = { address: usdc, mint: minter.mint };
  const result = await runLifecycle({ chain, publicClient, rpc: node.rpc, artifact: compileSettlement(), token });
  console.log(JSON.stringify({ schemaVersion: "settlement-fork-check/v1", network: "local fork of Monad Testnet", chainId: chain.id, forkBlock: forkBlock.toString(),
    asset: { address: usdc, name, version, implementation, domainSeparator: separator }, anvilVersion: node.version,
    codeSha256: sourceHashes([...CHECKED_SOURCES.filter(path => !path.includes("MockFiatToken")), "scripts/settlement-fork-check.mjs", "scripts/fork-usdc.mjs"]),
    checksPassed: result.checks + 1, observedAt: Math.floor(Date.now() / 1000), gasHeadroomBps: HEADROOM_BPS, gas: result.gas,
    verified: ["Client-derived EIP-712 domain equals the deployed USDC domain separator", "Buyer EIP-3009 authorization accepted by Circle's FiatToken implementation",
      "Full lifecycle, rejections, allocations, timeout, withdrawal and reconciliation against real USDC"],
    limitations: ["Local fork; no transaction reached Monad Testnet", "Buyer USDC minted on the fork through an impersonated master minter", "Gas measured under local MonadTen execution of forked state"] }, null, 2));
} finally { await node.stop(); }
