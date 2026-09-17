// Data facade: pages read through here so the source (backend API vs. direct
// on-chain reads) can switch without touching components. The chain is always
// the source of truth for status/money; the backend adds title, description
// and full submission text.
import {
  apiGetBounty,
  apiGetSubmission,
  apiListBounties,
  checkBackendHealth,
} from "./api.js";
import {
  computeSubmissionHash,
  fetchOnChainBounties,
  fetchOnChainBounty,
  BountyStatus,
  STATUS_KEYS,
} from "./contract.js";
import { getAllBountyMeta, getBountyMeta, getSubmission } from "./localStore.js";

export const DATA_SOURCES = ["auto", "backend", "chain"];

/**
 * Resolve the effective source for a mode:
 *  - "backend"/"chain": forced
 *  - "auto": backend when /api/health answers, otherwise chain
 */
export async function resolveDataSource(mode) {
  if (mode === "backend" || mode === "chain") return mode;
  return (await checkBackendHealth()) ? "backend" : "chain";
}

const STATUS_NAME_TO_ENUM = {
  open: BountyStatus.Open,
  submitted: BountyStatus.Submitted,
  paid: BountyStatus.Paid,
  cancelled: BountyStatus.Cancelled,
};

/** Tolerantly normalize a backend record (metadata + indexed chain state). */
function normalizeBackendBounty(record) {
  const status =
    typeof record.status === "string"
      ? STATUS_NAME_TO_ENUM[record.status.toLowerCase()]
      : Number(record.status);
  return {
    id: Number(record.onChainId ?? record.id),
    title: record.title ?? null,
    description: record.description ?? null,
    poster: record.posterAddress ?? record.poster ?? null,
    hunter: record.hunterAddress ?? record.hunter ?? null,
    amount: record.amount != null ? BigInt(record.amount) : null,
    deadline: record.deadline != null ? Number(record.deadline) : null,
    status: Number.isInteger(status) ? status : null,
    submissionHash: record.submissionHash ?? null,
    pending: Boolean(record.pending),
  };
}

function mergeMeta(onChain, meta) {
  return { ...onChain, title: meta?.title ?? null, description: meta?.description ?? null };
}

/**
 * List bounties. `status` is an optional lowercase filter key
 * ("open" | "submitted" | "paid" | "cancelled"); `poster`/`hunter` filter by
 * address. Source "backend" trusts the API; "chain" reads the contract and
 * merges locally cached metadata.
 */
export async function loadBountyList({ source, readContract, status, poster, hunter }) {
  if (source === "backend") {
    const records = await apiListBounties({ status, poster, hunter });
    return records.map(normalizeBackendBounty);
  }
  const bounties = await fetchOnChainBounties(readContract);
  const meta = getAllBountyMeta();
  const lowerPoster = poster?.toLowerCase();
  const lowerHunter = hunter?.toLowerCase();
  return bounties
    .map((b) => mergeMeta(b, meta[String(b.id)]))
    .filter((b) => (status ? STATUS_KEYS[b.status] === status : true))
    .filter((b) => (lowerPoster ? b.poster.toLowerCase() === lowerPoster : true))
    .filter((b) => (lowerHunter ? b.hunter.toLowerCase() === lowerHunter : true));
}

/** Load one bounty with metadata merged in. Returns null when not found. */
export async function loadBountyDetail({ source, readContract, id }) {
  if (source === "backend") {
    try {
      return normalizeBackendBounty(await apiGetBounty(id));
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }
  const bounty = await fetchOnChainBounty(readContract, id);
  return bounty ? mergeMeta(bounty, getBountyMeta(id)) : null;
}

/**
 * Load the full submission text for a bounty. The backend enforces
 * poster/hunter-only access (403); the local fallback applies the same check
 * client-side. The content is verified against the on-chain hash.
 */
export async function loadSubmission({ source, bounty, viewerAddress }) {
  const isParty =
    viewerAddress &&
    (viewerAddress.toLowerCase() === bounty.poster.toLowerCase() ||
      viewerAddress.toLowerCase() === bounty.hunter.toLowerCase());
  if (!isParty) return null;

  let record = null;
  if (source === "backend") {
    try {
      record = await apiGetSubmission(bounty.id, viewerAddress);
    } catch (err) {
      if (err.status !== 403 && err.status !== 404) throw err;
      return null;
    }
  } else {
    record = getSubmission(bounty.id);
  }
  if (!record) return null;

  const content = record.content;
  const contentHash = record.contentHash ?? computeSubmissionHash(content);
  return {
    content,
    contentHash,
    hunterAddress: record.hunterAddress,
    submittedAt: record.submittedAt ?? null,
    verified:
      bounty.submissionHash &&
      contentHash.toLowerCase() === bounty.submissionHash.toLowerCase(),
  };
}
