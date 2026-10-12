import solc from "solc";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const SETTLEMENT_ABI_PATH = new URL("../contracts/AttemptSettlement.abi.json", import.meta.url);
const settings = Object.freeze({ optimizer: { enabled: true, runs: 200 }, evmVersion: "osaka" });

export function compileSettlement(includeTestFixtures = false) {
  const source = readFileSync(new URL("../contracts/AttemptSettlement.sol", import.meta.url), "utf8");
  const input = { language: "Solidity", sources: { "AttemptSettlement.sol": { content: source } },
    settings: { ...settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } } } };
  if (includeTestFixtures) input.sources["MockFiatToken.sol"] = { content: readFileSync(new URL("../contracts/test/MockFiatToken.sol", import.meta.url), "utf8") };
  const imported = {};
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import(path) {
    if (!path.startsWith("@openzeppelin/contracts/") || path.includes("..")) return { error: "Unsupported import" };
    return { contents: imported[path] = readFileSync(new URL(`../node_modules/${path}`, import.meta.url), "utf8") };
  } }));
  const errors = output.errors?.filter(e => e.severity === "error") ?? [];
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join("\n"));
  const c = output.contracts["AttemptSettlement.sol"].AttemptSettlement;
  const testFixtures = includeTestFixtures ? Object.fromEntries(["MockFiatToken"].map(name => {
    const fixture = output.contracts["MockFiatToken.sol"][name];
    return [name, { abi: fixture.abi, bytecode: `0x${fixture.evm.bytecode.object}` }];
  })) : undefined;
  // Self-contained input for explorer or Sourcify verification of the deployed contract.
  // Built only without fixtures, so it carries exactly the settlement contract's imports.
  const standardInput = includeTestFixtures ? undefined : { language: "Solidity", sources: { "AttemptSettlement.sol": { content: source },
    ...Object.fromEntries(Object.keys(imported).sort().map(path => [path, { content: imported[path] }])) },
    settings: { ...settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, compiler: solc.version(), evmVersion: "osaka", testFixtures,
    deployedBytecode: `0x${c.evm.deployedBytecode.object}`, immutableReferences: c.evm.deployedBytecode.immutableReferences,
    deployedBytecodeBytes: c.evm.deployedBytecode.object.length / 2, standardInput };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifact = compileSettlement();
  if (process.argv.includes("--write-abi")) {
    writeFileSync(SETTLEMENT_ABI_PATH, JSON.stringify(artifact.abi, null, 2) + "\n");
  } else {
    const output = process.env.LEMMAX_CONTRACT_OUTPUT;
    if (!output) throw new TypeError("Set LEMMAX_CONTRACT_OUTPUT to an ignored output directory");
    const { standardInput, ...compiled } = artifact;
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, "AttemptSettlement.json"), JSON.stringify(compiled, null, 2) + "\n");
    writeFileSync(join(output, "AttemptSettlement.standard-input.json"), JSON.stringify(standardInput, null, 2) + "\n");
  }
  console.log(JSON.stringify({ compiler: artifact.compiler, evmVersion: artifact.evmVersion, deployedBytecodeBytes: artifact.deployedBytecodeBytes }));
}
