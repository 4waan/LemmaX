import { readFileSync } from "node:fs";
import { BaseError, ContractFunctionRevertedError, getAddress } from "viem";
import { atomic, bytes32, normalizeQuote, normalizeReceipt } from "./attempt.mjs";
import { dipsIntoReserve, gasLimitFor } from "./monad.mjs";

export const SETTLEMENT_ABI = Object.freeze(JSON.parse(readFileSync(new URL("../contracts/AttemptSettlement.abi.json", import.meta.url), "utf8")));
export const ATTEMPT_STATES = Object.freeze(["none", "funded", "settled_success", "settled_failure", "refunded_timeout"]);

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
function revertReason(error) {
  const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : null;
  return revert?.data?.errorName ?? revert?.reason ?? "unknown_revert";
}

// Every write is estimated first. A rejected estimate costs nothing, while a mined
// revert on Monad still pays its whole gas limit. The limit is the estimate plus
// explicit headroom, because Monad charges the limit rather than the gas used.
export function createSettlementClient({ publicClient, address, gasHeadroomBps }) {
  const contract = getAddress(address);
  gasLimitFor(1n, gasHeadroomBps);
  const read = (functionName, args = []) => publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName, args });
  async function write(wallet, functionName, args, value = 0n) {
    const call = { address: contract, abi: SETTLEMENT_ABI, functionName, args, value, account: wallet.account };
    let estimate;
    try { estimate = await publicClient.estimateContractGas(call); }
    catch (error) { throw new SettlementRejected(functionName, revertReason(error)); }
    const gas = gasLimitFor(estimate, gasHeadroomBps);
    const hash = await wallet.writeContract({ ...call, chain: wallet.chain, gas });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new SettlementRejected(functionName, "reverted_after_inclusion");
    return { functionName, hash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      gasLimit: gas, gasEstimate: estimate, gasUsed: receipt.gasUsed };
  }
  return Object.freeze({
    address: contract,
    // The buyer wallet funds exactly the signed total; the contract rejects any other value.
    // Funding that would dip into the reserve balance is refused unless the caller states
    // that this transaction qualifies as an emptying transaction.
    async fund({ wallet, quote, signature, allowReserveDip = false }) {
      const value = fundingTotal(quote);
      if (allowReserveDip !== true && dipsIntoReserve(await publicClient.getBalance({ address: wallet.account.address }), value)) throw new SettlementRejected("fund", "reserve_balance_risk");
      return write(wallet, "fund", [quoteArgs(quote), signature], value);
    },
    settle({ wallet, receipt, signature }) { return write(wallet, "settle", [receiptArgs(receipt), signature]); },
    refundTimeout({ wallet, attemptId }) { return write(wallet, "refundTimeout", [bytes32(attemptId)]); },
    withdraw({ wallet, amount, destination }) { return write(wallet, "withdraw", [BigInt(atomic(amount)), getAddress(destination)]); },
    async attemptState(attemptId) { return ATTEMPT_STATES[Number(await read("attemptState", [bytes32(attemptId)]))]; },
    async credit(owner) { return (await read("credit", [getAddress(owner)])).toString(); },
    async approvedIssuer() { return getAddress(await read("approvedIssuer")); },
    // Liabilities are funds locked in open attempts plus credited balances. Forced or
    // donated native value can make the balance larger, never spendable credit.
    async ledger(blockNumber) {
      const at = blockNumber === undefined ? {} : { blockNumber };
      const [balance, lockedFunds, totalCredit] = await Promise.all([publicClient.getBalance({ address: contract, ...at }),
        publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName: "lockedFunds", ...at }),
        publicClient.readContract({ address: contract, abi: SETTLEMENT_ABI, functionName: "totalCredit", ...at })]);
      return { balance: balance.toString(), lockedFunds: lockedFunds.toString(), totalCredit: totalCredit.toString(),
        unallocated: (balance - lockedFunds - totalCredit).toString(), solvent: balance >= lockedFunds + totalCredit };
    },
  });
}
