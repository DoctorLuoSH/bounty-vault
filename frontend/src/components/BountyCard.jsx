import { Link } from "react-router-dom";
import StatusBadge from "./StatusBadge.jsx";
import { formatEth, formatTimestamp } from "../lib/format.js";
import { shortAddress } from "../lib/wallet.js";

/** Summary card used on the list and dashboard pages. */
export default function BountyCard({ bounty }) {
  return (
    <Link to={`/bounties/${bounty.id}`} className="card bounty-card">
      <div className="bounty-card-head">
        <h3>{bounty.title || `Bounty #${bounty.id}`}</h3>
        <StatusBadge status={bounty.status} />
      </div>
      {bounty.description && <p className="bounty-card-desc">{bounty.description}</p>}
      <dl className="bounty-card-meta">
        <div>
          <dt>Reward</dt>
          <dd>{bounty.amount != null ? `${formatEth(bounty.amount)} ETH` : "?"}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{formatTimestamp(bounty.deadline)}</dd>
        </div>
        <div>
          <dt>Poster</dt>
          <dd title={bounty.poster}>{shortAddress(bounty.poster)}</dd>
        </div>
      </dl>
      {bounty.pending && <p className="muted">Indexing pending…</p>}
    </Link>
  );
}
