// localStorage fallback for off-chain content while the backend is unavailable
// (docs/ARCHITECTURE.md §3 is the authoritative store; this is a browser-local
// stopgap so create/submit flows stay usable end-to-end without it). When the
// backend accepts a write, the local copy acts as a write-through cache.
import { CHAIN_ID, CONTRACT_ADDRESS } from "./config.js";

const HAS_STORAGE = typeof localStorage !== "undefined";

function namespace() {
  return `bv:${CHAIN_ID}:${(CONTRACT_ADDRESS || "unconfigured").toLowerCase()}`;
}

function key(kind, bountyId) {
  return `${namespace()}:${kind}:${bountyId}`;
}

function read(kind, bountyId) {
  if (!HAS_STORAGE) return null;
  try {
    const raw = localStorage.getItem(key(kind, bountyId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(kind, bountyId, value) {
  if (!HAS_STORAGE) return;
  try {
    localStorage.setItem(key(kind, bountyId), JSON.stringify(value));
  } catch {
    // storage full/blocked: non-fatal, the backend remains the real store
  }
}

function readAll(kind) {
  if (!HAS_STORAGE) return {};
  const prefix = `${namespace()}:${kind}:`;
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      try {
        out[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k));
      } catch {
        // ignore corrupted entries
      }
    }
  }
  return out;
}

/** Cache bounty metadata ({ title, description, ... }) locally. */
export function saveBountyMeta(bountyId, meta) {
  write("meta", bountyId, meta);
}

export function getBountyMeta(bountyId) {
  return read("meta", bountyId);
}

/** Map of bountyId -> metadata for every locally cached bounty. */
export function getAllBountyMeta() {
  return readAll("meta");
}

/** Cache a submission ({ content, hunterAddress, submitTxHash, submittedAt }). */
export function saveSubmission(bountyId, submission) {
  write("sub", bountyId, submission);
}

export function getSubmission(bountyId) {
  return read("sub", bountyId);
}
