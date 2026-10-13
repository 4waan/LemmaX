import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { V3 } from "../web/live.mjs";

// Copies the page's settled runs from its state directory into the repo, so a freshly
// deployed page replays real runs on this contract before it has settled its own.
// Runs hold only public data: attempt ids, claims, transactions, timings and payouts.
const dir = process.env.LEMMAX_STATE_DIR;
if (!dir) { console.error("Set LEMMAX_STATE_DIR to the live page's state directory."); process.exit(1); }
const state = JSON.parse(readFileSync(join(dir, "live-state.json"), "utf8"));
const runs = (state.runs ?? []).filter(run => run.settleTx && run.fundTx).slice(0, 10);
if (!runs.length) { console.error("No settled runs in that state directory."); process.exit(1); }
const out = new URL("../verification/live-runs-testnet.json", import.meta.url);
writeFileSync(out, `${JSON.stringify({ schemaVersion: "live-runs/v1", network: "testnet", chainId: 10143, contract: process.env.LEMMAX_SETTLEMENT_ADDRESS ?? V3.address,
  explorer: "https://testnet.monadvision.com", runs }, null, 2)}\n`);
console.log(`Wrote ${runs.length} runs to verification/live-runs-testnet.json`);
