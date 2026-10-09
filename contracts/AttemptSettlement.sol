// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Native-asset prototype. Signed company-approved evaluation is trusted.
/// Detailed records and commitment salts remain offchain.
contract AttemptSettlement is EIP712, ReentrancyGuard {
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
    struct Attempt {
        AttemptQuote quote;
        bytes32 quoteDigest;
        uint64 fundedAt;
        State state;
    }
    bytes32 public constant POLICY_HASH = keccak256("LemmaX/principal-refund-and-timeout-refund/v1");
    bytes32 public constant QUOTE_TYPEHASH = keccak256("AttemptQuote(bytes32 attemptId,bytes32 recordCommitment,bytes32 policyHash,address issuer,address buyer,address connectorPayee,address executorPayee,address evaluatorPayee,address evaluatorSigner,address asset,uint256 principal,uint256 executionCap,uint256 evaluationCap,uint64 quoteExpiresAt,uint64 executeBy,uint64 settleBy,uint8 timeoutMode)");
    bytes32 public constant RECEIPT_TYPEHASH = keccak256("EvaluationReceipt(bytes32 attemptId,bytes32 quoteDigest,bytes32 evidenceCommitment,uint8 outcome,uint256 executionUsed,uint256 evaluationUsed,uint64 completedAt,uint64 evaluatedAt)");
    address public immutable approvedIssuer;
    uint256 public lockedFunds;
    uint256 public totalCredit;
    mapping(address => uint256) public credit;
    mapping(bytes32 => Attempt) private attempts;

    error InvalidQuote();
    error InvalidAuthority();
    error InvalidReceipt();
    error InvalidState();
    error NotExpired();
    error InvalidWithdrawal();
    event AttemptCommitted(bytes32 indexed attemptId, bytes32 recordCommitment, bytes32 quoteDigest);
    event AttemptOutcome(bytes32 indexed attemptId, State state, bytes32 evidenceCommitment, uint256 executionUsed, uint256 evaluationUsed);
    event CreditWithdrawn(address indexed owner, address indexed destination, uint256 amount);

    constructor(address issuer) EIP712("LemmaXAttemptSettlement", "1") {
        if (issuer == address(0)) revert InvalidAuthority();
        approvedIssuer = issuer;
    }
    function quoteDigest(AttemptQuote memory q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
    }
    function receiptDigest(EvaluationReceipt memory r) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(RECEIPT_TYPEHASH, r)));
    }
    function attemptState(bytes32 id) external view returns (State) { return attempts[id].state; }

    function fund(AttemptQuote calldata q, bytes calldata signature) external payable nonReentrant {
        if (attempts[q.attemptId].state != State.None) revert InvalidState();
        if (msg.sender != q.buyer || q.issuer != approvedIssuer) revert InvalidAuthority();
        if (q.attemptId == bytes32(0) || q.recordCommitment == bytes32(0) || q.policyHash != POLICY_HASH
            || q.asset != address(0) || q.timeoutMode != 1 || q.connectorPayee == address(0)
            || q.executorPayee == address(0) || q.evaluatorPayee == address(0) || q.evaluatorSigner == address(0)
            || block.timestamp > q.quoteExpiresAt || q.quoteExpiresAt > q.executeBy || q.executeBy >= q.settleBy)
            revert InvalidQuote();
        bytes32 digest = quoteDigest(q);
        if (ECDSA.recover(digest, signature) != approvedIssuer) revert InvalidAuthority();
        uint256 total = q.principal + q.executionCap + q.evaluationCap;
        if (msg.value != total) revert InvalidQuote();
        attempts[q.attemptId] = Attempt(q, digest, uint64(block.timestamp), State.Funded);
        lockedFunds += total;
        emit AttemptCommitted(q.attemptId, q.recordCommitment, digest);
    }

    function settle(EvaluationReceipt calldata r, bytes calldata signature) external nonReentrant {
        Attempt storage a = attempts[r.attemptId];
        if (a.state != State.Funded) revert InvalidState();
        AttemptQuote storage q = a.quote;
        if (r.quoteDigest != a.quoteDigest || r.evidenceCommitment == bytes32(0)
            || (r.outcome != 1 && r.outcome != 2) || r.executionUsed > q.executionCap || r.evaluationUsed > q.evaluationCap
            || r.completedAt < a.fundedAt || r.completedAt > q.executeBy || r.evaluatedAt < r.completedAt
            || r.evaluatedAt > block.timestamp || block.timestamp > q.settleBy) revert InvalidReceipt();
        if (ECDSA.recover(receiptDigest(r), signature) != q.evaluatorSigner) revert InvalidAuthority();
        uint256 principalPaid = r.outcome == 1 ? q.principal : 0;
        a.state = r.outcome == 1 ? State.SettledSuccess : State.SettledFailure;
        uint256 total = q.principal + q.executionCap + q.evaluationCap;
        lockedFunds -= total;
        _credit(q.connectorPayee, principalPaid);
        _credit(q.executorPayee, r.executionUsed);
        _credit(q.evaluatorPayee, r.evaluationUsed);
        _credit(q.buyer, total - principalPaid - r.executionUsed - r.evaluationUsed);
        emit AttemptOutcome(r.attemptId, a.state, r.evidenceCommitment, r.executionUsed, r.evaluationUsed);
    }

    function refundTimeout(bytes32 id) external nonReentrant {
        Attempt storage a = attempts[id];
        if (a.state != State.Funded) revert InvalidState();
        if (block.timestamp <= a.quote.settleBy) revert NotExpired();
        a.state = State.RefundedTimeout;
        uint256 total = a.quote.principal + a.quote.executionCap + a.quote.evaluationCap;
        lockedFunds -= total;
        _credit(a.quote.buyer, total);
        emit AttemptOutcome(id, a.state, bytes32(0), 0, 0);
    }

    function _credit(address owner, uint256 amount) private {
        credit[owner] += amount;
        totalCredit += amount;
    }
    // Explicit owner withdrawal. Automatic threshold scheduling is separate.
    function withdraw(uint256 amount, address payable destination) external nonReentrant {
        if (amount == 0 || destination == address(0) || credit[msg.sender] < amount) revert InvalidWithdrawal();
        credit[msg.sender] -= amount;
        totalCredit -= amount;
        (bool sent,) = destination.call{value: amount}("");
        if (!sent) revert InvalidWithdrawal();
        emit CreditWithdrawn(msg.sender, destination, amount);
    }
}
