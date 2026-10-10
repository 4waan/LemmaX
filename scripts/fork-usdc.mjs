import assert from "node:assert/strict";
import { createWalletClient, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const FIAT_TOKEN_ABI = parseAbi(["function masterMinter() view returns (address)", "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function name() view returns (string)", "function version() view returns (string)",
  "function configureMinter(address minter, uint256 minterAllowedAmount) returns (bool)", "function mint(address to, uint256 amount) returns (bool)"]);

// Fork-only funding: mints Circle USDC through an impersonated master minter and sets
// native balances. It needs a local fork node's test RPC methods and never touches the network.
export async function forkMinter({ publicClient, chain, rpc, usdc }) {
  const masterMinter = await publicClient.readContract({ address: usdc, abi: FIAT_TOKEN_ABI, functionName: "masterMinter" });
  const minter = privateKeyToAccount(generatePrivateKey());
  for (const address of [masterMinter, minter.address]) await publicClient.request({ method: "anvil_setBalance", params: [address, "0x3635c9adc5dea00000"] });
  const send = async (account, functionName, args) => {
    const hash = await createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) }).writeContract({ address: usdc, abi: FIAT_TOKEN_ABI, functionName, args });
    assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, "success");
  };
  await publicClient.request({ method: "anvil_impersonateAccount", params: [masterMinter] });
  await send(masterMinter, "configureMinter", [minter.address, 10n ** 12n]);
  await publicClient.request({ method: "anvil_stopImpersonatingAccount", params: [masterMinter] });
  return {
    mint: (to, amount) => send(minter, "mint", [to, amount]),
    setMon: (address, wei) => publicClient.request({ method: "anvil_setBalance", params: [address, `0x${wei.toString(16)}`] }),
  };
}
