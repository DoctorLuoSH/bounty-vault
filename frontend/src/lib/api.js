// Backend REST client (docs/ARCHITECTURE.md §3.2). All calls are thin wrappers
// around fetch; failures throw ApiError with the HTTP status attached.
import { BACKEND_URL } from "./config.js";

const API_BASE = `${BACKEND_URL}/api`;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, `Backend unreachable: ${err.message}`);
  }
  if (!res.ok) {
    let message = `${method} ${path} failed with ${res.status}`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Quick availability probe with a short timeout. */
export async function checkBackendHealth(timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /bounties?status=&poster=&hunter= — filters are optional. */
export function apiListBounties({ status, poster, hunter } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (poster) params.set("poster", poster);
  if (hunter) params.set("hunter", hunter);
  const qs = params.toString();
  return request(`/bounties${qs ? `?${qs}` : ""}`);
}

/** GET /bounties/:onChainId */
export function apiGetBounty(onChainId) {
  return request(`/bounties/${onChainId}`);
}

/** POST /bounties — off-chain metadata for a confirmed BountyCreated tx. */
export function apiPostBounty({ onChainId, posterAddress, title, description, createTxHash }) {
  return request("/bounties", {
    method: "POST",
    body: { onChainId, posterAddress, title, description, createTxHash },
  });
}

/** POST /bounties/:onChainId/submissions — full submission text. */
export function apiPostSubmission(onChainId, { hunterAddress, content, submitTxHash }) {
  return request(`/bounties/${onChainId}/submissions`, {
    method: "POST",
    body: { hunterAddress, content, submitTxHash },
  });
}

/** GET /bounties/:onChainId/submission?address=… — poster/hunter only. */
export function apiGetSubmission(onChainId, address) {
  return request(`/bounties/${onChainId}/submission?address=${encodeURIComponent(address)}`);
}
