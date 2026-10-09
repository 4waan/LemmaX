import { loadSciFact, createSciFactIndex, SCIFACT_PROFILE } from "../src/scifact.mjs";
import { createPublicDirectory, ILLUSTRATIVE_SCENARIO } from "../src/directory.mjs";
import { loadRetrievalReport } from "../scripts/verify-retrieval.mjs";

const report = loadRetrievalReport();
const data = loadSciFact(process.env.LEMMAX_SCIFACT_DIR);
const directory = createPublicDirectory({ report, data, index: createSciFactIndex(data) });
console.log(JSON.stringify({
  observed: directory.assess({ profileRef: SCIFACT_PROFILE.profileRef }),
  conditionalDemonstration: directory.assess({ profileRef: SCIFACT_PROFILE.profileRef, scenarioRef: ILLUSTRATIVE_SCENARIO }),
  replays: report.offers.map(offer => directory.runBenchmarkCase({ offerRef: offer.offerRef, caseRef: report.perCase[0].caseRef })),
}, null, 2));
