// Human-readable ABI for contracts/contracts/BountyVault.sol.
// This file is the single source of the ABI for the frontend — components must
// never inline their own copies (docs/ARCHITECTURE.md §4.2).
export const BOUNTY_VAULT_ABI = [
  "function createBounty(uint64 deadline) payable returns (uint256 bountyId)",
  "function submitWork(uint256 bountyId, bytes32 submissionHash)",
  "function approveSubmission(uint256 bountyId)",
  "function cancelBounty(uint256 bountyId)",
  "function getBounty(uint256 bountyId) view returns (tuple(address poster, address hunter, uint256 amount, uint64 deadline, uint8 status, bytes32 submissionHash))",
  "function bountyCount() view returns (uint256)",
  "event BountyCreated(uint256 indexed bountyId, address indexed poster, uint256 amount, uint64 deadline)",
  "event WorkSubmitted(uint256 indexed bountyId, address indexed hunter, bytes32 submissionHash)",
  "event BountyPaid(uint256 indexed bountyId, address indexed hunter, uint256 amount)",
  "event BountyCancelled(uint256 indexed bountyId, uint256 refundAmount)",
  "error ZeroAmount()",
  "error InvalidDeadline()",
  "error BountyNotFound(uint256 bountyId)",
  "error WrongStatus(uint8 expected, uint8 actual)",
  "error NotPoster(address caller)",
  "error PosterCannotSubmit()",
  "error DeadlinePassed(uint64 deadline, uint64 now_)",
  "error EmptySubmissionHash()",
  "error TransferFailed(address to, uint256 amount)",
];
