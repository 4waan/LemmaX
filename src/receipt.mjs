import { publicAllocation } from "./rulebook.mjs";
import { formatUsdc } from "./terms.mjs";

// Who is paid what in one settlement transaction: transfers made automatically, and
// credit left owed below the payout minimum (paid automatically once it reaches it).
export function receiptFrom({ logs, txHash, quote, outcome, credits, names }) {
  const paid = logs.filter(l => l.transactionHash === txHash && l.eventName === "CreditPaid");
  const deferred = logs.filter(l => l.transactionHash === txHash && l.eventName === "PayoutDeferred");
  const allocation = publicAllocation(quote, outcome);
  const parties = [["provider", quote.connectorPayee, allocation.connector], ["LemmaX (execution)", quote.executorPayee, allocation.executor],
    ["checker", quote.evaluatorPayee, allocation.evaluator], ["buyer (returned)", quote.buyer, allocation.buyer]];
  const low = value => String(value).toLowerCase();
  const credit = Object.fromEntries(Object.entries(credits).map(([k, v]) => [low(k), v]));
  const name = Object.fromEntries(Object.entries(names).map(([k, v]) => [low(k), v]));
  return parties.filter(([, , amount]) => BigInt(amount) > 0n).map(([role, address, amount]) => {
    const owner = low(address);
    const transfer = paid.find(p => low(p.owner) === owner);
    return { role, name: name[owner] ?? null, address, earned: formatUsdc(amount),
      paidNow: transfer ? formatUsdc(transfer.amount) : "0", deferred: deferred.some(d => low(d.owner) === owner),
      creditOwed: formatUsdc(credit[owner] ?? "0") };
  });
}
