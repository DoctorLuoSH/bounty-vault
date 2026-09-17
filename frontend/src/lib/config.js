// Centralized runtime configuration. Values come from Vite env vars in the
// browser; the Node fallback (process.env) lets scripts/e2e-local.mjs reuse the
// same modules outside Vite.
const viteEnv = (typeof import.meta !== "undefined" && import.meta.env) || {};
const nodeEnv = typeof process !== "undefined" && process.env ? process.env : {};
const env = { ...nodeEnv, ...viteEnv };

/** Deployed BountyVault address (required for any on-chain read/write). */
export const CONTRACT_ADDRESS = env.VITE_CONTRACT_ADDRESS || "";

/** Chain the wallet must be on. Defaults to Sepolia per docs/ARCHITECTURE.md §4.3. */
export const CHAIN_ID = Number(env.VITE_CHAIN_ID || 11155111);
export const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);

/** Backend API base URL (no trailing slash). */
export const BACKEND_URL = (env.VITE_BACKEND_URL || "http://localhost:3001").replace(/\/+$/, "");

/** True once a contract address has been configured. */
export const IS_CONFIGURED = Boolean(CONTRACT_ADDRESS);
