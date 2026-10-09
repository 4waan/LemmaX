import solc from "solc";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export function compileSettlement(includeTestFixtures = false) {
  const source = readFileSync(new URL("../contracts/AttemptSettlement.sol", import.meta.url), "utf8");
  const input = { language: "Solidity", sources: { "AttemptSettlement.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "osaka",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } };
  if (includeTestFixtures) input.sources["WithdrawalReceivers.sol"] = { content: readFileSync(new URL("../contracts/test/WithdrawalReceivers.sol", import.meta.url), "utf8") };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import(path) {
    if (!path.startsWith("@openzeppelin/contracts/") || path.includes("..")) return { error: "Unsupported import" };
    return { contents: readFileSync(new URL(`../node_modules/${path}`, import.meta.url), "utf8") };
  } }));
  const errors = output.errors?.filter(e => e.severity === "error") ?? [];
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join("\n"));
  const c = output.contracts["AttemptSettlement.sol"].AttemptSettlement;
  const testFixtures = includeTestFixtures ? Object.fromEntries(["RejectReceiver", "ReentrantReceiver"].map(name => {
    const fixture = output.contracts["WithdrawalReceivers.sol"][name];
    return [name, { abi: fixture.abi, bytecode: `0x${fixture.evm.bytecode.object}` }];
  })) : undefined;
  return { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, compiler: solc.version(), evmVersion: "osaka", testFixtures,
    deployedBytecodeBytes: c.evm.deployedBytecode.object.length / 2 };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.LEMMAX_CONTRACT_OUTPUT;
  if (!output) throw new TypeError("Set LEMMAX_CONTRACT_OUTPUT to an ignored output directory");
  const artifact = compileSettlement();
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "AttemptSettlement.json"), JSON.stringify(artifact, null, 2) + "\n");
  console.log(JSON.stringify({ compiler: artifact.compiler, evmVersion: artifact.evmVersion, deployedBytecodeBytes: artifact.deployedBytecodeBytes }));
}
