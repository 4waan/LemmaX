// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// Local test double for Circle FiatToken v2.2: six decimals, EIP-3009 receive
/// authorization accepting EOA or ERC-1271 signatures, and a blocklist. Anyone can
/// mint, block or set a shortfall; it is never deployed outside local checks.
contract MockFiatToken is ERC20, EIP712 {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    mapping(address => bool) public isBlacklisted;
    uint256 public shortfall;

    constructor() ERC20("USDC", "USDC") EIP712("USDC", "2") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function version() external pure returns (string memory) { return "2"; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function blacklist(address account, bool blocked) external { isBlacklisted[account] = blocked; }
    function setShortfall(uint256 amount) external { shortfall = amount; }

    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter,
        uint256 validBefore, bytes32 nonce, bytes memory signature) external {
        require(to == msg.sender, "FiatTokenV2: caller must be the payee");
        require(block.timestamp > validAfter, "FiatTokenV2: authorization is not yet valid");
        require(block.timestamp < validBefore, "FiatTokenV2: authorization is expired");
        require(!authorizationState[from][nonce], "FiatTokenV2: authorization is used or canceled");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)));
        require(SignatureChecker.isValidSignatureNow(from, digest, signature), "FiatTokenV2: invalid signature");
        authorizationState[from][nonce] = true;
        _transfer(from, to, value - shortfall);
    }
    function _update(address from, address to, uint256 value) internal override {
        require(!isBlacklisted[from] && !isBlacklisted[to], "Blacklistable: account is blacklisted");
        super._update(from, to, value);
    }
}
