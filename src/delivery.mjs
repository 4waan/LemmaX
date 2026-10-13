import { getAddress } from "viem";
import { readSettlementLogs } from "./reconcile.mjs";
import { receiptFrom } from "./receipt.mjs";

// Delivery for a funded attempt this operator quoted: the named checker runs the bought
// search inside its boundary, signs the outcome, and settles it on Monad. The buyer gets
// the source references it paid for, the checker's verdict, who was paid what in that one
// settlement, and the transaction to look it up. Only attempts this desk issued and that
// are funded on chain can be delivered.
export function createDelivery({ desk, settlement, evaluator, evaluatorWallet, publicClient, chainTime, confirm, names = {}, explorer = null, onSettled = () => {} }) {
  const delivering = new Set();
  return Object.freeze({
    async deliver({ attemptId }, { onProgress = () => {} } = {}) {
      const issued = desk.issued(attemptId);
      if (!issued) throw new TypeError("Unknown quote");
      const id = issued.quote.attemptId;
      if (getAddress(issued.quote.evaluatorSigner) !== getAddress(evaluator.address)) throw new TypeError("This attempt names a checker this server does not run");
      if (delivering.has(id)) throw new TypeError("Delivery already in progress for this attempt");
      delivering.add(id);
      try {
        const info = await settlement.attemptInfo(id);
        if (info.state !== "funded") throw new TypeError(info.state === "none" ? "Attempt is not funded yet" : "Attempt is already settled or refunded");
        const caseRef = String(issued.record.taskRef).replace(/^public-demo\//, "");
        onProgress({ progress: 1, total: 3, message: "Searching" });
        const evaluation = await evaluator.evaluate({ quote: issued.quote, record: issued.record, salt: issued.salt, caseRef, fundedAt: info.fundedAt, chainTime: await chainTime() });
        const sources = evaluation.evidence.sources.map(s => ({ sourceRef: s.sourceRef, rank: s.rank }));
        if (!evaluation.receipt) {
          return { attemptId: id, outcome: "unresolved", sources, settled: false,
            note: "The checker could not sign a verdict. Anyone can refund the attempt in full after its settlement deadline." };
        }
        onProgress({ progress: 2, total: 3, message: evaluation.outcome === "success" ? "Checked: hit" : "Checked: miss" });
        const settled = await settlement.settle({ wallet: evaluatorWallet, quote: issued.quote, receipt: evaluation.receipt, signature: evaluation.signature });
        await confirm(settled);
        onSettled(settled);
        onProgress({ progress: 3, total: 3, message: "Settled" });
        const logs = await readSettlementLogs({ publicClient, address: settlement.address, fromBlock: settled.blockNumber, toBlock: settled.blockNumber, maxBlockRange: 1n });
        const outcome = { state: evaluation.outcome === "success" ? "settled_success" : "settled_failure",
          executionUsed: evaluation.receipt.executionUsed, evaluationUsed: evaluation.receipt.evaluationUsed };
        const owners = [issued.quote.connectorPayee, issued.quote.executorPayee, issued.quote.evaluatorPayee, issued.quote.buyer].map(a => getAddress(a));
        const credits = Object.fromEntries(await Promise.all(owners.map(async o => [o, await settlement.credit(o)])));
        return { attemptId: id, outcome: evaluation.outcome, settled: true, sources, relevant: evaluation.evidence.checks.relevant,
          checker: getAddress(issued.quote.evaluatorSigner), settleTx: settled.hash, block: settled.blockNumber.toString(),
          payouts: receiptFrom({ logs, txHash: settled.hash, quote: issued.quote, outcome, credits, names }),
          link: explorer ? `${explorer}/tx/${settled.hash}` : null };
      } finally { delivering.delete(id); }
    },
  });
}
