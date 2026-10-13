import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrivyClient, generateAuthorizationSignature } from "@privy-io/node";
import { MONAD_NETWORKS, envAddress } from "../src/monad.mjs";
import { DEMO_TERMS } from "../src/terms.mjs";
import { buyerPrivyKeys, createConditionSetClient, keyFingerprint, mandatePolicy } from "../src/privy-buyer.mjs";

// Creates the demonstration buyer's Privy wallet once, with keys derived from the buyer's
// existing key: principal owns the wallet and the mandate, the agent signs under it, the
// guard owns the approved-digest set. Dry run by default; LEMMAX_PRIVY_SETUP=1 creates.
// The resulting IDs and address are public and recorded in deployments/privy-buyer.json.
const OUTPUT = fileURLToPath(new URL("../deployments/privy-buyer.json", import.meta.url));

async function main(env) {
  const keys = buyerPrivyKeys(env);
  const settlement = envAddress(env, "LEMMAX_SETTLEMENT_ADDRESS", { optional: true }) ?? "0x2DA6DAE2731BDf030543AF18D8083d5de6a012a7";
  const maxValue = (BigInt(DEMO_TERMS.principal) + BigInt(DEMO_TERMS.executionCap) + BigInt(DEMO_TERMS.evaluationCap)).toString();
  const plan = { settlement, usdc: MONAD_NETWORKS.testnet.usdc, chainId: 10143, maxValue,
    keyFingerprints: Object.fromEntries(Object.entries(keys).map(([role, k]) => [role, keyFingerprint(k.publicKey)])) };
  if (existsSync(OUTPUT)) return { alreadyCreated: true, ...JSON.parse(readFileSync(OUTPUT, "utf8")) };
  if (env.LEMMAX_PRIVY_SETUP !== "1") return { dryRun: true, ...plan, next: "Set LEMMAX_PRIVY_SETUP=1 with PRIVY_APP_ID and PRIVY_APP_SECRET to create the wallet." };
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new TypeError("Set PRIVY_APP_ID and PRIVY_APP_SECRET");
  const privy = new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  const sets = createConditionSetClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET, ownerPrivateKey: keys.guard.privateKey, sign: generateAuthorizationSignature });
  const quorum = await privy.keyQuorums().create({ public_keys: [keys.agent.publicKey], authorization_threshold: 1, display_name: "LemmaX buyer agent" });
  // Condition-set names are unique within a Privy app, so each run names its own set.
  const set = await sets.create(`lemmax-approved-quote-digests-${randomBytes(4).toString("hex")}`, keys.guard.publicKey);
  const policy = await privy.policies().create({ ...mandatePolicy({ chainId: 10143, usdc: plan.usdc, settlement, maxValue, conditionSetId: set.id }),
    owner: { public_key: keys.principal.publicKey } });
  const wallet = await privy.wallets().create({ chain_type: "ethereum", owner: { public_key: keys.principal.publicKey },
    additional_signers: [{ signer_id: quorum.id, override_policy_ids: [policy.id] }] });
  const record = { schemaVersion: "privy-buyer/v1", walletId: wallet.id, address: wallet.address, agentKeyQuorumId: quorum.id,
    conditionSetId: set.id, policyId: policy.id, ...plan };
  writeFileSync(OUTPUT, JSON.stringify(record, null, 2) + "\n");
  return { created: true, ...record };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await main(process.env), null, 2) + "\n"); }
  catch (error) {
    const code = error?.code ?? error?.error?.code ?? null;
    console.error(`Privy setup stopped: ${error instanceof TypeError ? error.message : `${error.name ?? "Error"}${error.status ? ` (HTTP ${error.status}${code ? `, ${code}` : ""})` : ""}`}`);
    process.exitCode = 1;
  }
}
