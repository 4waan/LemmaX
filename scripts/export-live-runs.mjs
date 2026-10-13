import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { V3 } from "../web/live.mjs";

// Copies the page's settled runs from its state directory into the repo, so a freshly
// deployed page replays real runs on this contract before it has settled its own. Runs
// already recorded for the same contract are kept, newest first, twenty at most.
// Runs hold only public data: attempt ids, claims, transactions, timings and payouts.
const dir = process.env.LEMMAX_STATE_DIR;
if (!dir) { console.error("Set LEMMAX_STATE_DIR to the live page's state directory."); process.exit(1); }
const state = JSON.parse(readFileSync(join(dir, "live-state.json"), "utf8"));
const fresh = (state.runs ?? []).filter(run => run.settleTx && run.fundTx);
if (!fresh.length) { console.error("No settled runs in that state directory."); process.exit(1); }
const out = new URL("../verification/live-runs-testnet.json", import.meta.url);
const contract = process.env.LEMMAX_SETTLEMENT_ADDRESS ?? V3.address;
const recorded = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
const earlier = recorded?.contract?.toLowerCase() === contract.toLowerCase() ? recorded.runs : [];
const seen = new Set(), runs = [...fresh, ...earlier].filter(run => !seen.has(run.attemptId) && seen.add(run.attemptId))
  .sort((a, b) => (BigInt(b.block) > BigInt(a.block) ? 1 : -1)).slice(0, 20);
writeFileSync(out, `${JSON.stringify({ schemaVersion: "live-runs/v1", network: "testnet", chainId: 10143, contract,
  explorer: "https://testnet.monadvision.com", runs }, null, 2)}\n`);
console.log(`Wrote ${runs.length} runs to verification/live-runs-testnet.json`);
