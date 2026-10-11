import { encodeAbiParameters, getAddress, parseAbi } from "viem";

// ERC-8004 v2.0.0 registries on Monad Testnet (upgradeable proxies, source verified).
export const ERC8004 = Object.freeze({
  chainId: 10143,
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
});
export const IDENTITY_ABI = parseAbi([
  "function register() returns (uint256)",
  "function register(string agentURI, (string metadataKey, bytes metadataValue)[] metadata) returns (uint256)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
export const REPUTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

const REPOSITORY = "https://github.com/4waan/LemmaX";
// The four LemmaX agents. Descriptions say what each does and who operates it.
export const LEMMAX_AGENTS = Object.freeze({
  directory: { name: "LemmaX Directory", owner: "deployer",
    description: "Ranks retrieval offers for AI agents by outcome probability and expected cost, and sells outcome-conditioned retrieval attempts settled in USDC on Monad. Read-only MCP tools are public; paid tools run on an operator-configured server." },
  evaluator: { name: "LemmaX Evaluator", owner: "evaluator",
    description: "Company-approved evaluator for LemmaX demonstration attempts. Checks each attempt against its committed record and signs the settlement receipt at the published tariff. Operator-run." },
  evaluatorB: { name: "LemmaX Evaluator-b", owner: "evaluatorB",
    description: "Labelled fault-injection evaluator for the LemmaX demonstration, used once to show the public auditor and the buyer's guard refusing an above-tariff evaluator. Operator-run." },
  provider: { name: "LemmaX Retrieval Provider", owner: "provider",
    description: "Provider of LemmaX's public benchmark retrieval offers (BM25 and TF-IDF over SciFact). Receives the principal when an attempt is accepted. Demonstration provider." },
});

// Registration file (ERC-8004 registration-v1) with a LemmaX extension naming the
// settlement contract, the hash-pinned rulebook, the public auditor and the disclosure policy.
export function registrationFile({ role, agentId = null, settlement, rulebook, auditor = null }) {
  const agent = LEMMAX_AGENTS[role];
  if (!agent) throw new TypeError("Unknown LemmaX agent role");
  const services = [{ name: "web", endpoint: REPOSITORY }];
  if (role === "directory") services.unshift({ name: "MCP", endpoint: `${REPOSITORY}#readme`, version: "2025-11-25" });
  return { type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: agent.name, description: agent.description, services,
    x402Support: false, active: true,
    registrations: agentId === null ? [] : [{ agentId: Number(agentId), agentRegistry: `eip155:${ERC8004.chainId}:${ERC8004.identity}` }],
    supportedTrust: ["crypto-economic", "reputation"],
    lemmax: { role, chainId: ERC8004.chainId, settlement: getAddress(settlement), rulebook: { ref: rulebook.ref, hash: rulebook.hash },
      auditor, disclosurePolicy: `${REPOSITORY}/blob/main/docs/LemmaX-Architecture.md#4-settlement-and-erc-8004-reputation` } };
}
export const dataUri = file => `data:application/json;base64,${Buffer.from(JSON.stringify(file), "utf8").toString("base64")}`;

// Onchain metadata: the settlement contract and rulebook hash, readable without the file.
export function registrationMetadata({ role, settlement, rulebook }) {
  return [
    { metadataKey: "lemmax.role", metadataValue: `0x${Buffer.from(role, "utf8").toString("hex")}` },
    { metadataKey: "lemmax.settlement", metadataValue: encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [BigInt(ERC8004.chainId), getAddress(settlement)]) },
    { metadataKey: "lemmax.rulebook", metadataValue: rulebook.hash },
  ];
}
