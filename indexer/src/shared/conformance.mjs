import { getAddress, keccak256, stringToBytes } from "viem";

// Pure conformance rules shared by the Envio indexer, the buyer's guard and the tests.
// They check what the settlement contract cannot know: the published tariff, deadline
// profiles, payees, the evaluator roster and where LemmaX's own addresses are paid.
// Every verdict names the party responsible: the issuer for terms it signed, the quote's
// evaluator signer for charges it attested.

// Canonical JSON: sorted keys, no whitespace. The rulebook hash is keccak256 of its bytes.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const rulebookHash = rulebook => keccak256(stringToBytes(canonicalJson(rulebook)));

const lower = value => getAddress(value).toLowerCase();

export function rulebookIndex(rulebook) {
  if (rulebook?.schemaVersion !== "lemmax-rulebook/v1") throw new TypeError("Unsupported rulebook");
  const evaluators = new Map(rulebook.roles.evaluators.map(e => [lower(e.signer), { ...e, payee: lower(e.payee) }]));
  return { rulebook, hash: rulebookHash(rulebook), terms: rulebook.terms, profiles: rulebook.profiles,
    asset: lower(rulebook.asset), issuer: lower(rulebook.roles.issuer.address), executor: lower(rulebook.roles.executor.address),
    connectors: new Set(rulebook.roles.connectors.map(c => lower(c.address))), evaluators,
    operatorIncome: new Set(rulebook.roles.operatorIncomeAddresses.map(lower)),
    severity: Object.fromEntries(Object.entries(rulebook.verdicts).flatMap(([level, codes]) => codes.map(code => [code, level]))) };
}

const verdict = (index, code, party, role, detail) => ({ code, severity: index.severity[code] ?? "recorded", party, role, detail, rulebookHash: index.hash });

// Terms the issuer signed, checkable before funding (by the guard) and after (by the indexer).
export function quoteVerdicts(quote, index) {
  const q = Object.fromEntries(Object.entries(quote).map(([k, v]) => [k, typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : String(v)]));
  const issuer = q.issuer, out = [];
  const t = index.terms;
  if (q.asset !== index.asset || q.principal !== t.principal || q.executionCap !== t.executionCap || q.evaluationCap !== t.evaluationCap)
    out.push(verdict(index, "off_terms", issuer, "issuer", "amounts or asset differ from the published terms"));
  if (q.issuer !== index.issuer) out.push(verdict(index, "off_terms", issuer, "issuer", "issuer is not the published issuer"));
  if (!index.connectors.has(q.connectorPayee)) out.push(verdict(index, "off_terms", issuer, "issuer", "connector payee is not published"));
  if (q.executorPayee !== index.executor) out.push(verdict(index, "off_terms", issuer, "issuer", "executor payee is not published"));
  const execute = BigInt(q.executeBy) - BigInt(q.quoteExpiresAt), settle = BigInt(q.settleBy) - BigInt(q.quoteExpiresAt);
  if (!Object.values(index.profiles).some(p => BigInt(p.executeAfterFunding) === execute && BigInt(p.settleAfterFunding) === settle))
    out.push(verdict(index, "off_profile", issuer, "issuer", "deadlines match no published profile"));
  const evaluator = index.evaluators.get(q.evaluatorSigner);
  if (!evaluator || q.evaluatorSigner === q.issuer || q.evaluatorSigner === q.executorPayee)
    out.push(verdict(index, "unregistered_or_self_evaluator", issuer, "issuer", "evaluator is not on the roster or is the issuer or executor"));
  else if (q.evaluatorPayee !== evaluator.payee) out.push(verdict(index, "off_terms", issuer, "issuer", "evaluator payee differs from the roster"));
  if (index.operatorIncome.has(q.connectorPayee) || index.operatorIncome.has(q.evaluatorPayee) || index.operatorIncome.has(q.buyer))
    out.push(verdict(index, "operator_income", issuer, "issuer", "an operator address is paid beyond the execution charge"));
  return out;
}

// Charges the evaluator attested in a settled outcome. The caps the buyer funded are
// headroom; under the published terms the charge is exactly the tariff.
export function outcomeVerdicts(quote, outcome, index) {
  if (outcome.state !== "settled_success" && outcome.state !== "settled_failure") return [];
  const signer = String(quote.evaluatorSigner).toLowerCase(), t = index.terms, out = [];
  const execution = BigInt(outcome.executionUsed), evaluation = BigInt(outcome.evaluationUsed);
  if (execution > BigInt(t.executionCharge) || evaluation > BigInt(t.evaluationCharge))
    out.push(verdict(index, "above_tariff", signer, "evaluator", `charged ${execution}/${evaluation} against tariff ${t.executionCharge}/${t.evaluationCharge}`));
  else if (execution < BigInt(t.executionCharge) || evaluation < BigInt(t.evaluationCharge))
    out.push(verdict(index, "below_tariff", signer, "evaluator", `charged ${execution}/${evaluation} against tariff ${t.executionCharge}/${t.evaluationCharge}`));
  return out;
}

// Who receives what, from the public terms and the outcome alone.
export function publicAllocation(quote, outcome) {
  const P = BigInt(quote.principal), E = BigInt(quote.executionCap), V = BigInt(quote.evaluationCap), total = P + E + V;
  if (outcome.state === "refunded_timeout") return { connector: "0", executor: "0", evaluator: "0", buyer: total.toString(), total: total.toString() };
  const e = BigInt(outcome.executionUsed), v = BigInt(outcome.evaluationUsed), principal = outcome.state === "settled_success" ? P : 0n;
  return { connector: principal.toString(), executor: e.toString(), evaluator: v.toString(), buyer: (total - principal - e - v).toString(), total: total.toString() };
}

// The guard's admission decision for one quote: the quote's own terms, the records of the
// parties it names, and the freshness of the index those records come from. Fails closed.
export function admission({ quote, index, records, indexLagBlocks, maxLagBlocks = 30 }) {
  const reasons = quoteVerdicts(quote, index).filter(v => v.severity === "blocking").map(v => v.code);
  if (typeof indexLagBlocks !== "number" || !Number.isFinite(indexLagBlocks) || indexLagBlocks > maxLagBlocks) reasons.push("index_stale");
  for (const [role, party] of [["issuer", quote.issuer], ["evaluator", quote.evaluatorSigner]]) {
    const record = records?.[String(party).toLowerCase()];
    if (record && record.rulebookHash === index.hash && Number(record.blocking) > 0) reasons.push(`${role}_flagged`);
  }
  return { admit: reasons.length === 0, reasons };
}
