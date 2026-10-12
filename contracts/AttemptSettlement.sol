// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice EIP-3009 receive authorization as implemented by Circle's FiatToken v2.2.
/// Only the payee may submit it, so the transfer cannot be front-run around this contract.
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter,
        uint256 validBefore, bytes32 nonce, bytes memory signature) external;
}

/// @notice USDC settlement prototype. Signed company-approved evaluation is trusted.
/// Detailed records and commitment salts remain offchain. The buyer's EIP-3009
/// authorization uses the quote digest as its nonce, so one buyer signature binds the
/// payment to every quote term and any relayer can submit funding. Only the quote
/// digest is stored; settlement and refund take the quote back as calldata.
/// Credits pay out automatically: once an owner's credit reaches its bar (at least
/// MIN_PAYOUT), the whole credit is transferred in the same transaction, so payees and
/// buyers never need MON to collect. A refused transfer keeps the credit for later.
contract AttemptSettlement is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum State { None, Funded, SettledSuccess, SettledFailure, RefundedTimeout }
    struct AttemptQuote {
        bytes32 attemptId;
        bytes32 recordCommitment;
        bytes32 policyHash;
        address issuer;
        address buyer;
        address connectorPayee;
        address executorPayee;
        address evaluatorPayee;
        address evaluatorSigner;
        address asset;
        uint256 principal;
        uint256 executionCap;
        uint256 evaluationCap;
        uint64 quoteExpiresAt;
        uint64 executeBy;
        uint64 settleBy;
        uint8 timeoutMode;
    }
    struct EvaluationReceipt {
        bytes32 attemptId;
        bytes32 quoteDigest;
        bytes32 evidenceCommitment;
        uint8 outcome;
        uint256 executionUsed;
        uint256 evaluationUsed;
        uint64 completedAt;
        uint64 evaluatedAt;
    }
    struct BuyerAuthorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes signature;
    }
    struct Attempt {
        bytes32 quoteDigest;
        uint64 fundedAt;
        State state;
    }
    struct PayoutInstruction {
        address owner;
        address destination;
        uint256 bar;
        uint256 nonce;
        uint64 deadline;
    }
    struct Payout {
        address destination;
        uint256 bar;
    }
    bytes32 public constant POLICY_HASH = keccak256("LemmaX/principal-refund-and-timeout-refund/v1");
    bytes32 public constant QUOTE_TYPEHASH = keccak256("AttemptQuote(bytes32 attemptId,bytes32 recordCommitment,bytes32 policyHash,address issuer,address buyer,address connectorPayee,address executorPayee,address evaluatorPayee,address evaluatorSigner,address asset,uint256 principal,uint256 executionCap,uint256 evaluationCap,uint64 quoteExpiresAt,uint64 executeBy,uint64 settleBy,uint8 timeoutMode)");
    bytes32 public constant PAYOUT_TYPEHASH = keccak256("PayoutInstruction(address owner,address destination,uint256 bar,uint256 nonce,uint64 deadline)");
    /// 0.01 USDC: below this a payout's gas is too large a share of the amount moved.
    uint256 public constant MIN_PAYOUT = 10_000;
    bytes32 public constant RECEIPT_TYPEHASH = keccak256("EvaluationReceipt(bytes32 attemptId,bytes32 quoteDigest,bytes32 evidenceCommitment,uint8 outcome,uint256 executionUsed,uint256 evaluationUsed,uint64 completedAt,uint64 evaluatedAt)");
    address public immutable approvedIssuer;
    IERC20 public immutable asset;
    uint256 public lockedFunds;
    uint256 public totalCredit;
    mapping(address => uint256) public credit;
    mapping(bytes32 => Attempt) private attempts;
    mapping(address => Payout) private payouts;
    mapping(address => uint256) public payoutNonce;

    error InvalidQuote();
    error InvalidAuthority();
    error InvalidReceipt();
    error InvalidState();
    error NotExpired();
    error InvalidWithdrawal();
    error InvalidInstruction();
    event AttemptCommitted(bytes32 indexed attemptId, bytes32 recordCommitment, bytes32 quoteDigest);
    /// Public quote terms at funding, so indexers and buyers can audit without calldata.
    event AttemptTerms(bytes32 indexed attemptId, address indexed buyer, address indexed evaluatorSigner, AttemptQuote quote);
    event AttemptOutcome(bytes32 indexed attemptId, State state, bytes32 evidenceCommitment, uint256 executionUsed, uint256 evaluationUsed);
    event CreditWithdrawn(address indexed owner, address indexed destination, uint256 amount);
    event CreditPaid(address indexed owner, address indexed destination, uint256 amount);
    event PayoutDeferred(address indexed owner, address indexed destination, uint256 amount);
    event PayoutInstructionSet(address indexed owner, address indexed destination, uint256 bar, uint256 nonce);

    constructor(address issuer, address token) EIP712("LemmaXAttemptSettlement", "2") {
        if (issuer == address(0) || token == address(0)) revert InvalidAuthority();
        approvedIssuer = issuer;
        asset = IERC20(token);
    }
    function quoteDigest(AttemptQuote memory q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
    }
    function receiptDigest(EvaluationReceipt memory r) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RECEIPT_TYPEHASH, r)));
    }
    function payoutDigest(PayoutInstruction memory p) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(PAYOUT_TYPEHASH, p)));
    }
    /// Effective payout destination and bar: the owner itself at MIN_PAYOUT unless instructed.
    function payoutOf(address owner) public view returns (address destination, uint256 bar) {
        Payout storage p = payouts[owner];
        return (p.destination == address(0) ? owner : p.destination, p.bar == 0 ? MIN_PAYOUT : p.bar);
    }
    function attemptState(bytes32 id) external view returns (State) { return attempts[id].state; }
    function attemptInfo(bytes32 id) external view returns (bytes32 digest, uint64 fundedAt, State state) {
        Attempt storage a = attempts[id];
        return (a.quoteDigest, a.fundedAt, a.state);
    }

    function fund(AttemptQuote calldata q, bytes calldata issuerSignature, BuyerAuthorization calldata buyer) external nonReentrant {
        if (attempts[q.attemptId].state != State.None) revert InvalidState();
        if (q.issuer != approvedIssuer) revert InvalidAuthority();
        if (q.attemptId == bytes32(0) || q.recordCommitment == bytes32(0) || q.policyHash != POLICY_HASH
            || q.asset != address(asset) || q.timeoutMode != 1 || q.buyer == address(0) || q.connectorPayee == address(0)
            || q.executorPayee == address(0) || q.evaluatorPayee == address(0) || q.evaluatorSigner == address(0)
            || q.evaluatorSigner == approvedIssuer
            || block.timestamp > q.quoteExpiresAt || q.quoteExpiresAt > q.executeBy || q.executeBy >= q.settleBy)
            revert InvalidQuote();
        bytes32 digest = quoteDigest(q);
        if (ECDSA.recover(digest, issuerSignature) != approvedIssuer) revert InvalidAuthority();
        uint256 total = q.principal + q.executionCap + q.evaluationCap;
        attempts[q.attemptId] = Attempt(digest, uint64(block.timestamp), State.Funded);
        lockedFunds += total;
        uint256 balance = asset.balanceOf(address(this));
        IReceiveWithAuthorization(address(asset)).receiveWithAuthorization(q.buyer, address(this), total,
            buyer.validAfter, buyer.validBefore, digest, buyer.signature);
        if (asset.balanceOf(address(this)) - balance != total) revert InvalidQuote();
        emit AttemptCommitted(q.attemptId, q.recordCommitment, digest);
        emit AttemptTerms(q.attemptId, q.buyer, q.evaluatorSigner, q);
    }

    function settle(AttemptQuote calldata q, EvaluationReceipt calldata r, bytes calldata signature) external nonReentrant {
        Attempt storage a = _funded(q);
        if (r.attemptId != q.attemptId || r.quoteDigest != a.quoteDigest || r.evidenceCommitment == bytes32(0)
            || (r.outcome != 1 && r.outcome != 2) || r.executionUsed > q.executionCap || r.evaluationUsed > q.evaluationCap
            || r.completedAt < a.fundedAt || r.completedAt > q.executeBy || r.evaluatedAt < r.completedAt
            || r.evaluatedAt > block.timestamp || block.timestamp > q.settleBy) revert InvalidReceipt();
        if (ECDSA.recover(receiptDigest(r), signature) != q.evaluatorSigner) revert InvalidAuthority();
        uint256 principalPaid = r.outcome == 1 ? q.principal : 0;
        a.state = r.outcome == 1 ? State.SettledSuccess : State.SettledFailure;
        uint256 total = q.principal + q.executionCap + q.evaluationCap;
        lockedFunds -= total;
        emit AttemptOutcome(r.attemptId, a.state, r.evidenceCommitment, r.executionUsed, r.evaluationUsed);
        _credit(q.connectorPayee, principalPaid);
        _credit(q.executorPayee, r.executionUsed);
        _credit(q.evaluatorPayee, r.evaluationUsed);
        _credit(q.buyer, total - principalPaid - r.executionUsed - r.evaluationUsed);
    }

    function refundTimeout(AttemptQuote calldata q) external nonReentrant {
        Attempt storage a = _funded(q);
        if (block.timestamp <= q.settleBy) revert NotExpired();
        a.state = State.RefundedTimeout;
        uint256 total = q.principal + q.executionCap + q.evaluationCap;
        lockedFunds -= total;
        emit AttemptOutcome(q.attemptId, a.state, bytes32(0), 0, 0);
        _credit(q.buyer, total);
    }

    function _funded(AttemptQuote calldata q) private view returns (Attempt storage a) {
        a = attempts[q.attemptId];
        if (a.state != State.Funded) revert InvalidState();
        if (quoteDigest(q) != a.quoteDigest) revert InvalidQuote();
    }
    function _credit(address owner, uint256 amount) private {
        if (amount == 0) return;
        credit[owner] += amount;
        totalCredit += amount;
        _pay(owner);
    }
    // Pays the whole credit once it reaches the owner's bar. The transfer must not be able
    // to block settlement, so a refusal (blocked destination, paused token) restores the
    // credit and records the deferral; sweep or the next credit retries it.
    function _pay(address owner) private {
        uint256 amount = credit[owner];
        (address destination, uint256 bar) = payoutOf(owner);
        if (amount == 0 || amount < bar) return;
        credit[owner] = 0;
        totalCredit -= amount;
        if (SafeERC20.trySafeTransfer(asset, destination, amount)) {
            emit CreditPaid(owner, destination, amount);
        } else {
            credit[owner] = amount;
            totalCredit += amount;
            emit PayoutDeferred(owner, destination, amount);
        }
    }

    /// Sets where and from what amount an owner's credit is paid. Anyone may relay the
    /// owner's EIP-712 signature (EOA or ERC-1271), so the owner needs no MON; the owner may
    /// also call it directly. Nonces make each instruction usable once and in order.
    function setPayoutInstruction(PayoutInstruction calldata p, bytes calldata signature) external nonReentrant {
        if (p.destination == address(0) || p.destination == address(this) || p.bar < MIN_PAYOUT
            || p.nonce != payoutNonce[p.owner] || block.timestamp > p.deadline) revert InvalidInstruction();
        if (msg.sender != p.owner && !SignatureChecker.isValidSignatureNow(p.owner, payoutDigest(p), signature)) revert InvalidAuthority();
        payoutNonce[p.owner] = p.nonce + 1;
        payouts[p.owner] = Payout(p.destination, p.bar);
        emit PayoutInstructionSet(p.owner, p.destination, p.bar, p.nonce);
        _pay(p.owner);
    }

    /// Permissionless retry: pays every listed owner whose credit has reached its bar.
    function sweep(address[] calldata owners) external nonReentrant {
        for (uint256 i; i < owners.length; ++i) _pay(owners[i]);
    }

    // Explicit owner withdrawal of any amount, for owners who hold MON. A token that
    // refuses the transfer (for example a blocked destination) reverts the whole call.
    function withdraw(uint256 amount, address destination) external nonReentrant {
        if (amount == 0 || destination == address(0) || destination == address(this) || credit[msg.sender] < amount) revert InvalidWithdrawal();
        credit[msg.sender] -= amount;
        totalCredit -= amount;
        asset.safeTransfer(destination, amount);
        emit CreditWithdrawn(msg.sender, destination, amount);
    }
}
