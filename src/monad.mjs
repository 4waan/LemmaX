import { createPublicClient, defineChain, http } from "viem";
import { monad, monadTestnet } from "viem/chains";

const localChain = defineChain({ id: 31337, name: "Local Monad execution",
  nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
// Circle-issued USDC (six decimals) is the settlement asset; local checks deploy a mock.
export const MONAD_NETWORKS = Object.freeze({
  local: Object.freeze({ chain: localChain, mainnet: false, usdc: null }),
  testnet: Object.freeze({ chain: monadTestnet, mainnet: false, usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3" }),
  mainnet: Object.freeze({ chain: monad, mainnet: true, usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" }),
});
export const CONFIRMATION_STAGES = Object.freeze(["included", "finalized", "verified"]);
// A finalized block's execution state root is agreed three blocks later.
export const VERIFIED_LAG_BLOCKS = 3n;

// Operators name the RPC endpoint explicitly; the connection refuses any other chain.
export async function connectMonad({ network, rpcUrl, allowMainnet = false, pollingInterval }) {
  if (!Object.hasOwn(MONAD_NETWORKS, network)) throw new TypeError("Network must be local, testnet or mainnet");
  const profile = MONAD_NETWORKS[network];
  if (profile.mainnet && allowMainnet !== true) throw new TypeError("Mainnet requires explicit permission");
  if (typeof rpcUrl !== "string" || !/^https?:\/\/\S+$/.test(rpcUrl)) throw new TypeError("Provide an explicit http(s) RPC URL");
  const chain = { ...profile.chain, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, cacheTime: 0, transport: http(rpcUrl, { retryCount: 0 }),
    ...(pollingInterval === undefined ? {} : { pollingInterval }) });
  const reported = await publicClient.getChainId();
  if (reported !== chain.id) throw new TypeError(`RPC reports chain ${reported}, expected ${chain.id} for ${network}`);
  return { network, chain, publicClient };
}

// Monad charges the transaction gas limit, not the gas used, so unused headroom is
// paid. Headroom covers state changes between estimation and inclusion and is explicit.
export function gasLimitFor(estimate, headroomBps) {
  if (typeof estimate !== "bigint" || estimate <= 0n) throw new RangeError("Gas estimate must be a positive bigint");
  if (!Number.isSafeInteger(headroomBps) || headroomBps < 0 || headroomBps > 5000) throw new RangeError("Gas headroom must be 0 to 5000 basis points");
  return estimate + (estimate * BigInt(headroomBps) + 9999n) / 10000n;
}

// Offchain effects (releasing a connector run, crediting an external ledger) should
// follow a selected stage. "finalized" uses the RPC finalized tag; "verified" also
// waits for the execution state root. Both recheck that the block is still canonical.
export async function waitForStage(publicClient, { blockNumber, blockHash }, stage, { pollMs, timeoutMs }) {
  if (!CONFIRMATION_STAGES.includes(stage)) throw new TypeError("Unknown confirmation stage");
  if (typeof blockNumber !== "bigint" || typeof blockHash !== "string") throw new TypeError("Provide the inclusion block number and hash");
  for (const value of [pollMs, timeoutMs]) if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Polling and timeout must be positive milliseconds");
  if (stage === "included") return { stage, blockNumber, finalizedHead: null };
  const target = stage === "verified" ? blockNumber + VERIFIED_LAG_BLOCKS : blockNumber;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const head = await publicClient.getBlock({ blockTag: "finalized" });
    if (head.number >= target) {
      const canonical = await publicClient.getBlock({ blockNumber });
      if (canonical.hash !== blockHash) throw new Error("Inclusion block is no longer canonical");
      return { stage, blockNumber, finalizedHead: head.number };
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${stage}`);
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
