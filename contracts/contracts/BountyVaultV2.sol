// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BountyVaultV2 - Contest bounties: multiple submissions, poster-judged
/// winner, optimistic settlement fallback (COMP7610 final project, v2).
/// @notice Authoritative design: docs/CONTEST-V2.md. Posters lock ETH in escrow;
/// any number of hunters submit work before the deadline; the poster picks one
/// winner during the review window (or earlier, closing the contest); if the
/// poster never acts, anyone can settle the bounty to the FIRST submission once
/// the window has passed. All payouts are pull-based: prizes and refunds accrue
/// in pendingWithdrawals and are collected via withdraw(). v1 (BountyVault.sol)
/// stays deployed and untouched; v2 is a separate contract, not an upgrade.
contract BountyVaultV2 is ReentrancyGuard {
    enum BountyStatus {
        Open,
        Paid,
        Cancelled
    }

    struct Submission {
        address hunter;
        bytes32 submissionHash;
        uint64 submittedAt;
    }

    struct Bounty {
        address poster; // bounty creator, receives refunds
        uint256 amount; // escrowed wei (== msg.value at creation)
        uint64 deadline; // unix timestamp, seconds
        BountyStatus status;
        bytes32 metadataHash; // keccak256(utf8(bounty description)); may be 0x0
    }

    /// @notice Review window after the deadline during which only the poster may
    /// pick a winner. A contract-level constant on purpose: giving posters a
    /// per-bounty window would let them undermine the optimistic-settlement
    /// fallback (see docs/CONTEST-V2.md, parameter decisions).
    uint64 public constant REVIEW_PERIOD = 7 days;

    /// @notice Total number of bounties ever created; also the next bounty id.
    uint256 public bountyCount;

    /// @notice id => Bounty, ids start at 0.
    mapping(uint256 => Bounty) public bounties;

    /// @dev id => submissions, append-only, never iterated on-chain. Access is
    /// always by index (selectWinner by `index`, settleExpired reads [0] only).
    mapping(uint256 => Submission[]) internal _submissions;

    /// @notice id => hunter => 1-based position in the submissions array;
    /// 0 means the address has no live submission.
    mapping(uint256 => mapping(address => uint256)) public submissionIndexOf;

    /// @notice Pull-payment ledger: wei owed to an address, collectable via
    /// withdraw(). Credited exactly once per bounty resolution.
    mapping(address => uint256) public pendingWithdrawals;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed poster,
        uint256 amount,
        uint64 deadline,
        bytes32 metadataHash
    );

    /// @dev Emitted for both new submissions and overwrites; an overwrite keeps
    /// the submitter's original `index`.
    event WorkSubmitted(
        uint256 indexed bountyId,
        uint256 index,
        address indexed hunter,
        bytes32 submissionHash
    );

    event WinnerSelected(
        uint256 indexed bountyId,
        uint256 index,
        address indexed hunter,
        uint256 amount
    );

    event BountySettledExpired(
        uint256 indexed bountyId,
        address indexed hunter,
        uint256 amount
    );

    event BountyCancelled(uint256 indexed bountyId, uint256 refundAmount);

    event Withdrawn(address indexed account, uint256 amount);

    error ZeroAmount();
    error InvalidDeadline();
    error BountyNotFound(uint256 bountyId);
    error WrongStatus(BountyStatus expected, BountyStatus actual);
    error NotPoster(address caller);
    error PosterCannotSubmit();
    error DeadlinePassed(uint64 deadline, uint64 now_);
    error EmptySubmissionHash();
    error NoSubmissions(uint256 bountyId);
    error HasSubmissions(uint256 bountyId);
    error InvalidSubmissionIndex(uint256 bountyId, uint256 index);
    error ReviewPeriodEnded(uint256 selectBefore, uint256 now_);
    error ReviewPeriodActive(uint256 settleAfter, uint256 now_);
    error NothingToWithdraw(address caller);
    error TransferFailed(address to, uint256 amount);

    /// @notice Create a bounty and lock `msg.value` in escrow.
    /// @param deadline unix timestamp (seconds); must be strictly in the future.
    /// @param metadataHash keccak256 of the off-chain bounty description (the
    /// "requirement commitment"); bytes32(0) is allowed when no off-chain
    /// metadata is used.
    /// @return bountyId id of the newly created bounty (starts at 0).
    function createBounty(
        uint64 deadline,
        bytes32 metadataHash
    ) external payable returns (uint256 bountyId) {
        if (msg.value == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        bountyId = bountyCount;
        bounties[bountyId] = Bounty({
            poster: msg.sender,
            amount: msg.value,
            deadline: deadline,
            status: BountyStatus.Open,
            metadataHash: metadataHash
        });
        bountyCount = bountyId + 1;

        emit BountyCreated(bountyId, msg.sender, msg.value, deadline, metadataHash);
    }

    /// @notice Submit work while Open and block.timestamp <= deadline (inclusive
    /// boundary, same rule as v1 R2). One live submission per address: a repeat
    /// submission overwrites the sender's previous entry in place — same index,
    /// refreshed hash and timestamp — so revising work is cheap and a single
    /// address cannot spam the array.
    function submitWork(uint256 bountyId, bytes32 submissionHash) external {
        Bounty storage bounty = _getBounty(bountyId);
        if (bounty.status != BountyStatus.Open) {
            revert WrongStatus(BountyStatus.Open, bounty.status);
        }
        if (block.timestamp > bounty.deadline) {
            revert DeadlinePassed(bounty.deadline, uint64(block.timestamp));
        }
        if (msg.sender == bounty.poster) revert PosterCannotSubmit();
        if (submissionHash == bytes32(0)) revert EmptySubmissionHash();

        uint256 index1Based = submissionIndexOf[bountyId][msg.sender];
        if (index1Based != 0) {
            Submission storage existing = _submissions[bountyId][index1Based - 1];
            existing.submissionHash = submissionHash;
            existing.submittedAt = uint64(block.timestamp);
            emit WorkSubmitted(bountyId, index1Based - 1, msg.sender, submissionHash);
            return;
        }

        uint256 index = _submissions[bountyId].length;
        _submissions[bountyId].push(
            Submission({
                hunter: msg.sender,
                submissionHash: submissionHash,
                submittedAt: uint64(block.timestamp)
            })
        );
        submissionIndexOf[bountyId][msg.sender] = index + 1;

        emit WorkSubmitted(bountyId, index, msg.sender, submissionHash);
    }

    /// @notice Poster picks the winning submission; the full escrow is credited
    /// to that hunter (winner-take-all). Open -> Paid.
    /// @dev Allowed from creation until deadline + REVIEW_PERIOD (inclusive), so
    /// the poster may close the contest early once at least one submission
    /// exists. Contains no external calls — funds move when the hunter later
    /// calls withdraw() — so a winner that rejects ETH cannot block settlement.
    function selectWinner(uint256 bountyId, uint256 index) external {
        Bounty storage bounty = _getBounty(bountyId);
        if (bounty.status != BountyStatus.Open) {
            revert WrongStatus(BountyStatus.Open, bounty.status);
        }
        if (msg.sender != bounty.poster) revert NotPoster(msg.sender);
        // uint256 arithmetic: deadline + REVIEW_PERIOD cannot overflow.
        uint256 selectBefore = uint256(bounty.deadline) + REVIEW_PERIOD;
        if (block.timestamp > selectBefore) {
            revert ReviewPeriodEnded(selectBefore, block.timestamp);
        }
        Submission storage winner = _getSubmission(bountyId, index);

        bounty.status = BountyStatus.Paid;
        pendingWithdrawals[winner.hunter] += bounty.amount;

        emit WinnerSelected(bountyId, index, winner.hunter, bounty.amount);
    }

    /// @notice Optimistic settlement: once the review window has passed without
    /// the poster acting, ANYONE may settle the bounty to the first submission.
    /// Open -> Paid; the escrow is credited to submissions[0].hunter. This is the
    /// deterministic fallback against an idle poster: on-chain code cannot judge
    /// quality, so it rewards "earliest" instead of "best" (see docs/CONTEST-V2.md).
    function settleExpired(uint256 bountyId) external {
        Bounty storage bounty = _getBounty(bountyId);
        if (bounty.status != BountyStatus.Open) {
            revert WrongStatus(BountyStatus.Open, bounty.status);
        }
        uint256 settleAfter = uint256(bounty.deadline) + REVIEW_PERIOD;
        if (block.timestamp <= settleAfter) {
            revert ReviewPeriodActive(settleAfter, block.timestamp);
        }
        if (_submissions[bountyId].length == 0) revert NoSubmissions(bountyId);

        Submission storage winner = _submissions[bountyId][0];
        bounty.status = BountyStatus.Paid;
        pendingWithdrawals[winner.hunter] += bounty.amount;

        emit BountySettledExpired(bountyId, winner.hunter, bounty.amount);
    }

    /// @notice Poster cancels a bounty with zero submissions; the full escrow is
    /// credited back to the poster (pull). Open -> Cancelled. Allowed before AND
    /// after the deadline; a bounty with any submission can NEVER be cancelled
    /// (same rule as v1 R5), so a poster cannot walk away after seeing the work.
    function cancelBounty(uint256 bountyId) external {
        Bounty storage bounty = _getBounty(bountyId);
        if (bounty.status != BountyStatus.Open) {
            revert WrongStatus(BountyStatus.Open, bounty.status);
        }
        if (msg.sender != bounty.poster) revert NotPoster(msg.sender);
        if (_submissions[bountyId].length != 0) revert HasSubmissions(bountyId);

        bounty.status = BountyStatus.Cancelled;
        pendingWithdrawals[msg.sender] += bounty.amount;

        emit BountyCancelled(bountyId, bounty.amount);
    }

    /// @notice Collect everything owed to msg.sender (prizes and refunds).
    /// @dev Checks-Effects-Interactions + nonReentrant: the ledger is zeroed
    /// before the transfer; a failing transfer reverts the whole call and
    /// restores the credit, so a temporarily unreceivable address loses nothing.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw(msg.sender);

        pendingWithdrawals[msg.sender] = 0;

        emit Withdrawn(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed(msg.sender, amount);
    }

    /// @notice Number of submissions for a bounty (0 for unknown ids).
    function getSubmissionCount(uint256 bountyId) external view returns (uint256) {
        return _submissions[bountyId].length;
    }

    /// @notice Fetch one submission by index, for off-chain paging of the list.
    function getSubmission(
        uint256 bountyId,
        uint256 index
    ) external view returns (Submission memory) {
        return _getSubmission(bountyId, index);
    }

    /// @notice Convenience getter (the public mapping also works; this returns
    /// the struct). Nonexistent ids return a zeroed struct, mirroring the mapping.
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function _getBounty(uint256 bountyId) internal view returns (Bounty storage) {
        if (bountyId >= bountyCount) revert BountyNotFound(bountyId);
        return bounties[bountyId];
    }

    function _getSubmission(
        uint256 bountyId,
        uint256 index
    ) internal view returns (Submission storage) {
        if (index >= _submissions[bountyId].length) {
            revert InvalidSubmissionIndex(bountyId, index);
        }
        return _submissions[bountyId][index];
    }
}
