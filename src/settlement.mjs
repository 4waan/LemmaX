import { readFileSync } from "node:fs";
import { BaseError, ContractFunctionRevertedError, erc20Abi, getAddress, parseAbi } from "viem";
import { atomic, bytes32, fundingAuthorizationTypedData, normalizeQuote, normalizeReceipt, payoutInstructionTypedData } from "./attempt.mjs";
import { gasLimitFor } from "./monad.mjs";

export const SETTLEMENT_ABI = Object.freeze(JSON.parse(readFileSync(new URL("../contracts/AttemptSettlement.abi.json", import.meta.url), "utf8")));
export const ATTEMPT_STATES = Object.freeze(["none", "funded", "settled_success", "settled_failure", "refunded_timeout"]);
const TOKEN_ABI = [...erc20Abi, ...parseAbi(["function version() view returns (string)"])];

export class SettlementRejected extends Error {
  constructor(functionName, reason) {
    super(`${functionName} rejected: ${reason}`);
    this.name = "SettlementRejected"; this.functionName = functionName; this.reason = reason;
  }
}

// Contract tuples take bigint amounts and times; the offchain records keep canonical strings.
export function quoteArgs(quote) {
  const q = normalizeQuote(quote);
  return { ...q, principal: BigInt(q.principal), executionCap: BigInt(q.executionCap), evaluationCap: BigInt(q.evaluationCap),
    quoteExpiresAt: BigInt(q.quoteExpiresAt), executeBy: BigInt(q.executeBy), settleBy: BigInt(q.settleBy) };
}
export function receiptArgs(receipt) {
  const r = normalizeReceipt(receipt);
  return { ...r, executionUsed: BigInt(r.executionUsed), evaluationUsed: BigInt(r.evaluationUsed),
    completedAt: BigInt(r.completedAt), evaluatedAt: BigInt(r.evaluatedAt) };
}
export function fundingTotal(quote) {
  const q = normalizeQuote(quote);
  return BigInt(q.principal) + BigInt(q.executionCap) + BigInt(q.evaluationCap);
}
function authorizationArgs({ validAfter, validBefore, signature }) {
  if (typeof signature !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) throw new TypeError("Buyer authorization signature must be hex bytes");
  return { validAfter: BigInt(atomic(validAfter)), validBefore: BigInt(atomic(validBefore)), signature };
}
// Monad charges the gas limit, not the gas used, so an implausible estimate must never
// become the limit. Ceilings sit well above the worst case measured against real USDC on a
// fork (a settlement may pay up to four owners, each possibly a fresh USDC account) and far
// below what a runaway call could burn.
export const GAS_CEILINGS = Object.freeze({ fund: 400_000n, settle: 600_000n, refundTimeout: 250_000n, withdraw: 250_000n,
  setPayoutInstruction: 300_000n, sweepBase: 60_000n, sweepPerOwner: 100_000n });
export function gasCeiling(functionName, args = []) {
  if (functionName === "sweep") return GAS_CEILINGS.sweepBase + GAS_CEILINGS.sweepPerOwner * BigInt(args[0].length);
  const ceiling = GAS_CEILINGS[functionName];
  if (ceiling === undefined) throw new TypeError(`No gas ceiling for ${functionName}`);
  return ceiling;
}
function revertReason(error) {
  const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : null;
  return revert?.reason ?? revert?.data?.errorName ?? "unknown_revert";
}

// Every write is estimated first. A rejected estimate costs nothing, while a mined
// revert on Monad still pays its whole gas limit. The limit is the estimate plus
// explicit headroom, because Monad charges the limit rather than the gas used.
// The submitting wallet only relays and pays gas; it gains no authority over funds.
export function createSettlementClient({ publicClient, address, gasHeadroomBps }) {
  const contract = getAddress(address);
  gasLimitFor(1n, gasHeadroomBps);
  const read = (functionName, args = []) => publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName, args });
  let token = null;
  // One transaction at a time per sending wallet: the nonce stays in order, and each
  // estimate sees the state left by the previous transaction instead of racing it.
  const queues = new Map();
  function serialized(wallet, task) {
    const key = getAddress(wallet.account.address);
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
    queues.set(key, run.catch(() => {}));
    return run;
  }
  async function asset() {
    if (!token) {
      const tokenAddress = getAddress(await read("asset"));
      const tokenRead = functionName => publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName });
      const [name, version, decimals, chainId] = await Promise.all([tokenRead("name"), tokenRead("version"), tokenRead("decimals"), publicClient.getChainId()]);
      token = Object.freeze({ address: tokenAddress, name, version, decimals, chainId });
    }
    return token;
  }
  function write(wallet, functionName, args) {
    const ceiling = gasCeiling(functionName, args);
    return serialized(wallet, async () => {
      const call = { address: contract, abi: SETTLEMENT_ABI, functionName, args, account: wallet.account };
      let estimate;
      try { estimate = await publicClient.estimateContractGas(call); }
      catch (error) { throw new SettlementRejected(functionName, revertReason(error)); }
      const gas = gasLimitFor(estimate, gasHeadroomBps);
      if (gas > ceiling) throw new SettlementRejected(functionName, "gas_above_ceiling");
      const hash = await wallet.writeContract({ ...call, chain: wallet.chain, gas });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw Object.assign(new SettlementRejected(functionName, "reverted_after_inclusion"), { hash });
      return { functionName, hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
        gasLimit: gas, gasEstimate: estimate, gasUsed: receipt.gasUsed };
    });
  }
  return Object.freeze({
    address: contract,
    asset,
    // Typed data the buyer signs: pay the exact funding total to this contract, with the
    // quote digest as the EIP-3009 nonce. The window is the buyer's choice.
    async fundingAuthorization({ domain, quote, validAfter, validBefore }) {
      const t = await asset();
      return fundingAuthorizationTypedData({ token: { name: t.name, version: t.version, chainId: String(t.chainId), verifyingContract: t.address },
        domain, quote, validAfter, validBefore });
    },
    fund({ wallet, quote, issuerSignature, authorization }) {
      return write(wallet, "fund", [quoteArgs(quote), issuerSignature, authorizationArgs(authorization)]);
    },
    settle({ wallet, quote, receipt, signature }) { return write(wallet, "settle", [quoteArgs(quote), receiptArgs(receipt), signature]); },
    refundTimeout({ wallet, quote }) { return write(wallet, "refundTimeout", [quoteArgs(quote)]); },
    withdraw({ wallet, amount, destination }) { return write(wallet, "withdraw", [BigInt(atomic(amount)), getAddress(destination)]); },
    // Typed data an owner signs to route its payouts; the chain id comes from the node.
    async payoutInstruction({ owner, destination, bar, deadline }) {
      const [nonce, chainId] = await Promise.all([read("payoutNonce", [getAddress(owner)]), publicClient.getChainId()]);
      return payoutInstructionTypedData({ chainId: String(chainId), verifyingContract: contract }, { owner, destination, bar: String(bar), nonce: nonce.toString(), deadline: String(deadline) });
    },
    setPayoutInstruction({ wallet, instruction, signature = "0x" }) {
      const m = instruction.message;
      return write(wallet, "setPayoutInstruction", [{ owner: getAddress(m.owner), destination: getAddress(m.destination), bar: BigInt(m.bar),
        nonce: BigInt(m.nonce), deadline: BigInt(m.deadline) }, signature]);
    },
    sweep({ wallet, owners }) {
      if (!Array.isArray(owners) || !owners.length || owners.length > 50) throw new RangeError("Sweep takes 1 to 50 owners");
      return write(wallet, "sweep", [owners.map(o => getAddress(o))]);
    },
    async payoutOf(owner) {
      const [destination, bar] = await read("payoutOf", [getAddress(owner)]);
      return { destination: getAddress(destination), bar: bar.toString() };
    },
    async attemptState(attemptId) { return ATTEMPT_STATES[Number(await read("attemptState", [bytes32(attemptId)]))]; },
    async attemptInfo(attemptId) {
      const [quoteDigest, fundedAt, state] = await read("attemptInfo", [bytes32(attemptId)]);
      return { quoteDigest, fundedAt: fundedAt.toString(), state: ATTEMPT_STATES[Number(state)] };
    },
    async credit(owner) { return (await read("credit", [getAddress(owner)])).toString(); },
    async approvedIssuer() { return getAddress(await read("approvedIssuer")); },
    // Liabilities are funds locked in open attempts plus credited balances. Tokens sent
    // directly to the contract make the balance larger, never spendable credit.
    async ledger(blockNumber) {
      const at = blockNumber === undefined ? {} : { blockNumber };
      const t = await asset();
      const [balance, lockedFunds, totalCredit] = await Promise.all([
        publicClient.readContract({ address: t.address, abi: TOKEN_ABI, functionName: "balanceOf", args: [contract], ...at }),
        publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName: "lockedFunds", ...at }),
        publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName: "totalCredit", ...at })]);
      return { balance: balance.toString(), lockedFunds: lockedFunds.toString(), totalCredit: totalCredit.toString(),
        unallocated: (balance - lockedFunds - totalCredit).toString(), solvent: balance >= lockedFunds + totalCredit };
    },
  });
}
