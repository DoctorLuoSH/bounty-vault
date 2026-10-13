// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyVaultV2} from "../BountyVaultV2.sol";

/// @dev Test-only helper: attempts to reenter withdraw() from its receive
/// fallback. The reentrant call must be blocked by the ReentrancyGuard; the
/// mock swallows the inner revert (recording its data) so the outer withdrawal
/// succeeds and the test can assert exactly one payout happened.
contract ReentrantWithdrawer {
    BountyVaultV2 public immutable vault;
    bool public attackEnabled;
    /// @notice Revert data captured from the reentrant withdraw() attempt;
    /// empty when no attack ran.
    bytes public lastReentryError;

    constructor(address vault_) {
        vault = BountyVaultV2(vault_);
    }

    receive() external payable {
        if (attackEnabled) {
            try vault.withdraw() {} catch (bytes memory reason) {
                lastReentryError = reason;
            }
        }
    }

    function setAttackEnabled(bool enabled) external {
        attackEnabled = enabled;
    }

    /// @notice Act as hunter: submit work on behalf of this contract.
    function submitWork(uint256 bountyId, bytes32 submissionHash) external {
        vault.submitWork(bountyId, submissionHash);
    }

    function withdraw() external {
        vault.withdraw();
    }
}
