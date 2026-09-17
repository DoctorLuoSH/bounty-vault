// Small display helpers shared by components.
import { formatEther } from "ethers";
import { CHAIN_ID } from "./config.js";

/** Wei bigint -> trimmed ETH string (up to 6 decimals). */
export function formatEth(wei) {
  if (wei == null) return "?";
  const s = formatEther(wei);
  const [intPart, fracPart = ""] = s.split(".");
  const trimmed = fracPart.replace(/0+$/, "").slice(0, 6);
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/** Unix seconds -> locale date-time string. */
export function formatTimestamp(unixSeconds) {
  if (!unixSeconds) return "?";
  return new Date(unixSeconds * 1000).toLocaleString();
}

/** Block explorer tx URL (Sepolia only; null elsewhere). */
export function explorerTxUrl(hash) {
  if (CHAIN_ID === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
  return null;
}
