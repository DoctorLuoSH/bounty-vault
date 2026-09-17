import { STATUS_NAMES } from "../lib/contract.js";

/** Colored pill for the on-chain bounty status. */
export default function StatusBadge({ status }) {
  const name = STATUS_NAMES[Number(status)] ?? "Unknown";
  return <span className={`badge badge-${name.toLowerCase()}`}>{name}</span>;
}
