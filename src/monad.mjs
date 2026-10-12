import { createPublicClient, defineChain, getAddress, http } from "viem";
import { monad, monadTestnet } from "viem/chains";

const localChain = defineChain({ id: 31337, name: "Local Monad execution",
  nativeCurrency: { name: "Test", symbol: "TEST", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } });
// Circle-issued USDC (six decimals) is the settlement asset; local checks deploy a mock.
export const MONAD_NETWORKS = Object.freeze({
  local: Object.freeze({ chain: localChain, mainnet: false, usdc: null, ws: null }),
  testnet: Object.freeze({ chain: monadTestnet, mainnet: false, usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3", ws: "wss://testnet-rpc.monad.xyz" }),
  mainnet: Object.freeze({ chain: monad, mainnet: true, usdc: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", ws: "wss://rpc.monad.xyz" }),
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

// Reads an address from the environment without echoing a malformed value in the error.
export function envAddress(env, name, { optional = false } = {}) {
  const value = env[name];
  if (value === undefined || value === "") {
    if (optional) return null;
    throw new TypeError(`Set ${name}`);
  }
  try { return getAddress(value); } catch { throw new TypeError(`${name} is not a valid address`); }
}

// Monad re-sends a block's logs at each commit state over the monadLogs subscription:
// Proposed, Voted, Finalized, then Verified (finalized execution state root). A block
// can skip Voted, and an abandoned proposal sends nothing more.
export const COMMIT_STAGES = Object.freeze(["Proposed", "Voted", "Finalized", "Verified"]);

// Opens a monadLogs subscription for one contract before a transaction is sent, so no
// stage is missed, and buffers every stage seen per transaction. `until` replays the
// buffered stages of one transaction and resolves when it reaches the target stage.
export async function watchCommitStages({ wsUrl, address, topics = [], WebSocketImpl = globalThis.WebSocket, connectTimeoutMs = 5000, now = () => Date.now() }) {
  if (typeof wsUrl !== "string" || !/^wss?:\/\/\S+$/.test(wsUrl)) throw new TypeError("Provide an explicit ws(s) URL");
  if (typeof WebSocketImpl !== "function") throw new TypeError("No WebSocket implementation available");
  const socket = new WebSocketImpl(wsUrl);
  const byTransaction = new Map(), listeners = new Set();
  let subscription = null, failure = null;
  const fail = error => { failure ??= error; for (const listener of listeners) listener(); };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("monadLogs subscription timed out")); try { socket.close(); } catch {} }, connectTimeoutMs);
    socket.onerror = () => { clearTimeout(timer); reject(new Error("monadLogs connection failed")); fail(new Error("monadLogs connection failed")); };
    socket.onclose = () => fail(new Error("monadLogs connection closed"));
    socket.onopen = () => socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe",
      params: ["monadLogs", { address: getAddress(address), ...(topics.length ? { topics } : {}) }] }));
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch { return; }
      if (message.id === 1) {
        clearTimeout(timer);
        if (message.error || typeof message.result !== "string") return reject(new Error("monadLogs subscription refused"));
        subscription = message.result; return resolve();
      }
      const log = message.params?.subscription === subscription ? message.params.result : null;
      if (!log || !COMMIT_STAGES.includes(log.commitState) || typeof log.transactionHash !== "string") return;
      const key = log.transactionHash.toLowerCase();
      if (!byTransaction.has(key)) byTransaction.set(key, []);
      const seen = byTransaction.get(key);
      if (seen.some(s => s.stage === log.commitState && s.blockId === log.blockId)) return;
      seen.push({ stage: log.commitState, blockNumber: BigInt(log.blockNumber), blockId: log.blockId, at: now() });
      for (const listener of listeners) listener();
    };
  });
  return Object.freeze({
    until(transactionHash, { target = "Verified", onStage = () => {}, timeoutMs = 60000 } = {}) {
      const key = transactionHash.toLowerCase();
      let reported = 0;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`Timed out waiting for ${target}`)); }, timeoutMs);
        function check() {
          const seen = byTransaction.get(key) ?? [];
          for (; reported < seen.length; reported++) onStage(seen[reported]);
          const done = seen.find(s => s.stage === target);
          if (done) {
            clearTimeout(timer); listeners.delete(check);
            // Report only the stages of the block that reached the target.
            return resolve(seen.filter(s => s.blockId === done.blockId));
          }
          if (failure) { clearTimeout(timer); listeners.delete(check); reject(failure); }
        }
        listeners.add(check); check();
      });
    },
    close() { try { socket.close(); } catch {} },
  });
}
