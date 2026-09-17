// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BountyVault - Escrow for task bounties (COMP7610 final project MVP).
/// @notice Authoritative design: docs/ARCHITECTURE.md section 2. Posters lock ETH
/// in escrow when creating a bounty; the first valid submission moves the bounty
/// to Submitted; the poster then approves (pays the hunter) or, while no
/// submission exists, cancels (refund).
contract BountyVault is ReentrancyGuard {
    enum BountyStatus {
        Open,
        Submitted,
        Paid,
        Cancelled
    }

    struct Bounty {
        address poster; // bounty creator, receives refunds
        address hunter; // set by the first valid submitWork; address(0) while Open
        uint256 amount; // escrowed wei (== msg.value at creation)
        uint64 deadline; // unix timestamp, seconds
        BountyStatus status;
        bytes32 submissionHash; // keccak256(utf8(submission text)); 0x0 while Open
    }

    /// @notice Total number of bounties ever created; also the next bounty id.
    uint256 public bountyCount;

    /// @notice id => Bounty, ids start at 0.
    mapping(uint256 => Bounty) public bounties;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed poster,
        uint256 amount,
        uint64 deadline
    );

    event WorkSubmitted(
        uint256 indexed bountyId,
        address indexed hunter,
        bytes32 submissionHash
    );

    event BountyPaid(uint256 indexed bountyId, address indexed hunter, uint256 amount);

    event BountyCancelled(uint256 indexed bountyId, uint256 refundAmount);

    error ZeroAmount();
    error InvalidDeadline();
    error BountyNotFound(uint256 bountyId);
    error WrongStatus(BountyStatus expected, BountyStatus actual);
    error NotPoster(address caller);
    error PosterCannotSubmit();
    error DeadlinePassed(uint64 deadline, uint64 now_);
    error EmptySubmissionHash();
    error TransferFailed(address to, uint256 amount);

    /// @notice Create a bounty and lock `msg.value` in escrow.
    /// @param deadline unix timestamp (seconds); must be strictly in the future.
    /// @return bountyId id of the newly created bounty (starts at 0).
    function createBounty(uint64 deadline) external payable returns (uint256 bountyId) {
        if (msg.value == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        bountyId = bountyCount;
        bounties[bountyId] = Bounty({
            poster: msg.sender,
            hunter: address(0),
            amount: msg.value,
            deadline: deadline,
            status: BountyStatus.Open,
            submissionHash: bytes32(0)
        });
        bountyCount = bountyId + 1;

        emit BountyCreated(bountyId, msg.sender, msg.value, deadline);
    }

    /// @notice First submission wins (MVP): records hunter + hash, Open -> Submitted.
    /// @dev Accepted while block.timestamp <= deadline (inclusive boundary, R2).
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

        bounty.hunter = msg.sender;
        bounty.submissionHash = submissionHash;
        bounty.status = BountyStatus.Submitted;

        emit WorkSubmitted(bountyId, msg.sender, submissionHash);
    }

    /// @notice Poster accepts the submission; full escrow to hunter. Submitted -> Paid.
    /// @dev Callable after the deadline: the deadline gates submission, not
    /// settlement (R4). No protocol fee in MVP (R8).
    function approveSubmission(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _getBounty(bountyId);
        if (bounty.status != BountyStatus.Submitted) {
            revert WrongStatus(BountyStatus.Submitted, bounty.status);
        }
        if (msg.sender != bounty.poster) revert NotPoster(msg.sender);

        address hunter = bounty.hunter;
        uint256 amount = bounty.amount;
        bounty.status = BountyStatus.Paid;

        emit BountyPaid(bountyId, hunter, amount);

        (bool success, ) = hunter.call{value: amount}("");
        if (!success) revert TransferFailed(hunter, amount);
    }

    /// @notice Poster cancels an Open bounty; full refund to poster. Open -> Cancelled.
    /// @dev Allowed before AND after the deadline, as long as no submission exists
    /// (R5), so an untaken bounty never locks funds forever.
    function cancelBounty(uint256 bountyId) external nonReentrant {
        Bounty storage bounty = _getBounty(bountyId);
        if (bounty.status != BountyStatus.Open) {
            revert WrongStatus(BountyStatus.Open, bounty.status);
        }
        if (msg.sender != bounty.poster) revert NotPoster(msg.sender);

        uint256 amount = bounty.amount;
        bounty.status = BountyStatus.Cancelled;

        emit BountyCancelled(bountyId, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed(msg.sender, amount);
    }

    /// @notice Convenience getter (the public mapping also works; this returns the struct).
    /// @dev Nonexistent ids return a zeroed struct, mirroring the mapping getter.
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function _getBounty(uint256 bountyId) internal view returns (Bounty storage) {
        if (bountyId >= bountyCount) revert BountyNotFound(bountyId);
        return bounties[bountyId];
    }
}
