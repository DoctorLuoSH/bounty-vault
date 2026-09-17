// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyVault} from "../BountyVault.sol";

/// @dev Test-only helper: a contract account that rejects incoming ETH, so the
/// TransferFailed paths of approveSubmission and cancelBounty (R7) can be tested.
contract RejectingReceiver {
    receive() external payable {
        revert("RejectingReceiver: ETH rejected");
    }

    /// @notice Act as hunter: submit work on behalf of this contract.
    function submitWork(address vault, uint256 bountyId, bytes32 submissionHash) external {
        BountyVault(vault).submitWork(bountyId, submissionHash);
    }

    /// @notice Act as poster: create a bounty funded by this call's msg.value.
    function createBounty(address vault, uint64 deadline) external payable {
        BountyVault(vault).createBounty{value: msg.value}(deadline);
    }

    /// @notice Act as poster: cancel a bounty this contract created.
    function cancelBounty(address vault, uint256 bountyId) external {
        BountyVault(vault).cancelBounty(bountyId);
    }
}
