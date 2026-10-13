// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyVaultV2} from "../BountyVaultV2.sol";

/// @dev Test-only helper: a contract account that rejects incoming ETH. Used to
/// prove that v2 settlement never pushes funds — selectWinner / settleExpired /
/// cancelBounty succeed even when the payee cannot receive, because all payouts
/// are pull-based. Only this contract's own withdraw() can fail, by its own
/// choice, without locking anything else.
contract RejectingReceiverV2 {
    receive() external payable {
        revert("RejectingReceiverV2: ETH rejected");
    }

    /// @notice Act as hunter: submit work on behalf of this contract.
    function submitWork(address vault, uint256 bountyId, bytes32 submissionHash) external {
        BountyVaultV2(vault).submitWork(bountyId, submissionHash);
    }

    /// @notice Act as poster: create a bounty funded by this call's msg.value.
    function createBounty(address vault, uint64 deadline, bytes32 metadataHash) external payable {
        BountyVaultV2(vault).createBounty{value: msg.value}(deadline, metadataHash);
    }

    /// @notice Act as poster: cancel a bounty this contract created.
    function cancelBounty(address vault, uint256 bountyId) external {
        BountyVaultV2(vault).cancelBounty(bountyId);
    }

    /// @notice Attempt to withdraw; reverts via TransferFailed because this
    /// contract rejects the transfer.
    function withdraw(address vault) external {
        BountyVaultV2(vault).withdraw();
    }
}
