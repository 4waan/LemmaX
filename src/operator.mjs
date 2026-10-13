import { createWalletClient, http, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD_NETWORKS, connectMonad, envAddress, waitForStage, watchCommitStages } from "./monad.mjs";
import { SETTLEMENT_ABI, createSettlementClient } from "./settlement.mjs";
import { createQuoteIssuer } from "./issuer.mjs";
import { createPurchaseDesk } from "./purchase.mjs";
import { createDelivery } from "./delivery.mjs";
import { createEvaluator } from "./evaluator.mjs";
import { createSciFactIndex } from "./scifact.mjs";
import { usdcAtomic } from "./terms.mjs";

const HEADROOM_BPS = 1000;

// The paid tools switch on only when the operator has configured a settlement contract and
// the issuer key. Anything less keeps the server read-only.
export function operatorConfigured(env) {
  return Boolean(env.LEMMAX_SETTLEMENT_ADDRESS && env.FACILITATOR_PRIVATE_KEY);
}

function key(env, name) {
  try { return privateKeyToAccount(env[name]); } catch { throw new TypeError(`${name} is missing or is not a private key`); }
}

// Builds the purchase desk from the operator's environment: issuer and relayer key, the
// deployed contract, payees and caps. With the checker's key as well, the desk can deliver
// a funded attempt: run the search, sign the verdict and settle it. Keys are read here and
// never printed.
export async function createOperatorDesk({ env, data }) {
  const network = env.LEMMAX_MONAD_NETWORK ?? "testnet";
  const rpcUrl = env.LEMMAX_MONAD_RPC_URL;
  const { chain, publicClient } = await connectMonad({ network, rpcUrl, pollingInterval: 300 });
  const issuerAccount = key(env, "FACILITATOR_PRIVATE_KEY");
  const evaluatorSigner = envAddress(env, "LEMMAX_EVALUATOR_ADDRESS", { optional: true }) ?? key(env, "EVALUATOR_PRIVATE_KEY").address;
  if (evaluatorSigner === issuerAccount.address) throw new TypeError("Issuer and evaluator keys must differ");
  const settlement = createSettlementClient({ publicClient, address: envAddress(env, "LEMMAX_SETTLEMENT_ADDRESS"), gasHeadroomBps: HEADROOM_BPS });
  if (await settlement.approvedIssuer() !== issuerAccount.address) throw new TypeError("The settlement contract names a different issuer");
  const token = await settlement.asset();
  const issuer = createQuoteIssuer({ account: issuerAccount, domain: { chainId: String(chain.id), verifyingContract: settlement.address }, token,
    caps: { maxPerAttempt: usdcAtomic(env.LEMMA_MAX_USDC_PER_RESOLUTION), dailyCap: usdcAtomic(env.LEMMA_DAILY_USDC_CAP) },
    payees: { connector: envAddress(env, "LEMMA_PROVIDER_ADDRESS"), executor: issuerAccount.address, evaluator: evaluatorSigner, evaluatorSigner } });
  const relayer = createWalletClient({ account: issuerAccount, chain, transport: http(rpcUrl, { retryCount: 0 }) });
  const chainTime = async () => (await publicClient.getBlock()).timestamp.toString();
  const confirm = result => waitForStage(publicClient, result, "verified", { pollMs: 300, timeoutMs: 180000 });
  const stages = commitStageStream({ env, network, address: settlement.address });
  const desk = createPurchaseDesk({ issuer, settlement, relayer, data, chainTime, confirm, stages });
  if (!env.EVALUATOR_PRIVATE_KEY) return { desk, network, chainId: chain.id, settlement: settlement.address };
  const checker = key(env, "EVALUATOR_PRIVATE_KEY");
  if (checker.address !== evaluatorSigner) throw new TypeError("EVALUATOR_PRIVATE_KEY does not match LEMMAX_EVALUATOR_ADDRESS");
  const evaluator = createEvaluator({ account: checker, domain: { chainId: String(chain.id), verifyingContract: settlement.address }, index: createSciFactIndex(data), data });
  const delivery = createDelivery({ desk, settlement, evaluator, publicClient, chainTime, confirm,
    evaluatorWallet: createWalletClient({ account: checker, chain, transport: http(rpcUrl, { retryCount: 0 }) }),
    explorer: network === "testnet" ? "https://testnet.monadvision.com" : network === "mainnet" ? "https://monadvision.com" : null });
  return { desk: Object.freeze({ ...desk, deliver: delivery.deliver }), network, chainId: chain.id, settlement: settlement.address };
}

// Funding follows Monad's commit states over WebSocket when an endpoint is known; the
// subscription covers only the settlement contract's AttemptCommitted event.
export function commitStageStream({ env, network, address }) {
  const wsUrl = env.LEMMAX_MONAD_WS_URL ?? MONAD_NETWORKS[network]?.ws;
  if (!wsUrl) return null;
  const topic = toEventSelector(SETTLEMENT_ABI.find(item => item.type === "event" && item.name === "AttemptCommitted"));
  return () => watchCommitStages({ wsUrl, address, topics: [topic] });
}
