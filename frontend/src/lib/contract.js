// The single contract abstraction layer for the frontend (docs/ARCHITECTURE.md
// §4.2). All contract access goes through this module — no inline ABI copies.
import { Contract, Interface, keccak256, toUtf8Bytes } from "ethers";
import { BOUNTY_VAULT_ABI } from "./abi.js";
import { CONTRACT_ADDRESS, IS_CONFIGURED } from "./config.js";

export const BOUNTY_INTERFACE = new Interface(BOUNTY_VAULT_ABI);

/** Mirrors the on-chain enum BountyStatus { Open, Submitted, Paid, Cancelled }. */
export const BountyStatus = Object.freeze({
  Open: 0,
  Submitted: 1,
  Paid: 2,
  Cancelled: 3,
});

export const STATUS_NAMES = ["Open", "Submitted", "Paid", "Cancelled"];
export const STATUS_KEYS = ["open", "submitted", "paid", "cancelled"];

export function statusName(status) {
  return STATUS_NAMES[Number(status)] ?? "Unknown";
}

/** Read-only contract bound to a provider. */
export function getReadContract(provider) {
  assertConfigured();
  return new Contract(CONTRACT_ADDRESS, BOUNTY_VAULT_ABI, provider);
}

/** Write contract bound to a signer (MetaMask-backed in the app). */
export function getWriteContract(signer) {
  assertConfigured();
  return new Contract(CONTRACT_ADDRESS, BOUNTY_VAULT_ABI, signer);
}

function assertConfigured() {
  if (!IS_CONFIGURED) {
    throw new Error("VITE_CONTRACT_ADDRESS is not set — deploy the contract and configure frontend/.env");
  }
}

/**
 * On-chain proof hash of a submission, per docs/ARCHITECTURE.md §2.7:
 * keccak256(utf8(content)) computed on the raw user input — no trimming.
 */
export function computeSubmissionHash(content) {
  return keccak256(toUtf8Bytes(content));
}

/** Normalize an on-chain Bounty struct into a plain object. */
export function normalizeBounty(raw, id) {
  return {
    id: Number(id),
    poster: raw.poster,
    hunter: raw.hunter,
    amount: raw.amount, // bigint (wei)
    deadline: Number(raw.deadline), // unix seconds
    status: Number(raw.status),
    submissionHash: raw.submissionHash,
  };
}

/** Fetch every bounty from the contract (MVP scale: ids are 0..count-1). */
export async function fetchOnChainBounties(readContract) {
  const count = Number(await readContract.bountyCount());
  const bounties = [];
  for (let id = 0; id < count; id += 1) {
    bounties.push(normalizeBounty(await readContract.getBounty(id), id));
  }
  return bounties;
}

/** Fetch a single on-chain bounty, or null when the id does not exist. */
export async function fetchOnChainBounty(readContract, id) {
  const count = Number(await readContract.bountyCount());
  if (id < 0 || id >= count) return null;
  return normalizeBounty(await readContract.getBounty(id), id);
}

/**
 * Parse the first matching event of `eventName` from a transaction receipt.
 * Returns the parsed args object, or null when the event is absent.
 */
export function parseEventFromReceipt(receipt, eventName) {
  for (const log of receipt.logs || []) {
    let parsed = null;
    try {
      parsed = BOUNTY_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue; // not our contract's log
    }
    if (parsed && parsed.name === eventName) return parsed.args;
  }
  return null;
}

/**
 * Best-effort extraction of the revert data payload out of an ethers v6 error
 * (shapes differ between estimateGas failures, tx.send failures and RPC nodes).
 */
function extractRevertData(err) {
  return (
    err?.data ||
    err?.info?.error?.data ||
    err?.error?.data ||
    err?.info?.error?.error?.data ||
    null
  );
}

const CUSTOM_ERROR_MESSAGES = {
  ZeroAmount: () => "Reward must be greater than 0 ETH.",
  InvalidDeadline: () => "Deadline must be in the future.",
  BountyNotFound: () => "This bounty does not exist.",
  WrongStatus: () => "The bounty is no longer in the required status (refresh and retry).",
  NotPoster: () => "Only the bounty poster can do this.",
  PosterCannotSubmit: () => "The poster cannot submit work to their own bounty.",
  DeadlinePassed: () => "The deadline has passed; submissions are closed.",
  EmptySubmissionHash: () => "Submission content must not be empty.",
  TransferFailed: () => "The ETH transfer failed.",
};

/**
 * Translate an ethers/wallet error into a user-facing message.
 * Handles wallet rejection, insufficient funds, network errors and the
 * contract's custom errors (docs/ARCHITECTURE.md §2.5).
 */
export function describeTxError(err) {
  if (!err) return "Unknown error";
  const code = err.code;
  if (code === "ACTION_REJECTED" || err?.code === 4001 || err?.info?.error?.code === 4001 || err?.error?.code === 4001) {
    return "Transaction rejected in MetaMask.";
  }
  if (code === "INSUFFICIENT_FUNDS") {
    return "Insufficient funds to cover the reward plus gas.";
  }
  if (code === "NETWORK_ERROR") {
    return "Network error — check your connection and RPC endpoint.";
  }
  const data = extractRevertData(err);
  if (data) {
    try {
      const parsed = BOUNTY_INTERFACE.parseError(data);
      const make = parsed && CUSTOM_ERROR_MESSAGES[parsed.name];
      if (make) return make(parsed.args);
    } catch {
      // fall through to the generic message
    }
  }
  return err.shortMessage || err.reason || err.message || "Transaction failed";
}
