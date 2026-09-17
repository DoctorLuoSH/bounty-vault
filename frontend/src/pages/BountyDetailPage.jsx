import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { loadBountyDetail, loadSubmission } from "../lib/data.js";
import { BountyStatus } from "../lib/contract.js";
import { sameAddress, shortAddress } from "../lib/wallet.js";
import { formatEth, formatTimestamp } from "../lib/format.js";
import { useWallet } from "../lib/WalletContext.jsx";
import { useDataSource } from "../lib/DataSourceContext.jsx";
import { useReadContract } from "../lib/useReadContract.js";
import StatusBadge from "../components/StatusBadge.jsx";
import DeadlineCountdown from "../components/DeadlineCountdown.jsx";
import SubmitWorkForm from "../components/SubmitWorkForm.jsx";
import ApproveButton from "../components/ApproveButton.jsx";
import CancelButton from "../components/CancelButton.jsx";

/** `/bounties/:id` — status timeline, metadata and role-based actions. */
export default function BountyDetailPage() {
  const { id } = useParams();
  const bountyId = Number(id);
  const { account, connect } = useWallet();
  const { source } = useDataSource();
  const readContract = useReadContract();
  const [bounty, setBounty] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Refetched after every confirmed write so the UI tracks the chain.
  const load = useCallback(async () => {
    if (!source) return;
    if (source === "chain" && !readContract) return;
    setError(null);
    try {
      const detail = await loadBountyDetail({ source, readContract, id: bountyId });
      setBounty(detail);
      if (detail && detail.status >= BountyStatus.Submitted && account) {
        setSubmission(await loadSubmission({ source, bounty: detail, viewerAddress: account }));
      } else {
        setSubmission(null);
      }
    } catch (err) {
      setError(err.message || "Failed to load bounty");
    } finally {
      setLoading(false);
    }
  }, [source, readContract, bountyId, account]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error) {
    return (
      <p className="tx-status tx-failed">
        {error} <button className="btn btn-outline btn-small" onClick={load}>Retry</button>
      </p>
    );
  }
  if (!bounty) {
    return (
      <section className="panel">
        <h2>Bounty not found</h2>
        <p className="muted">No on-chain bounty with id {id}.</p>
        <Link to="/" className="btn btn-outline">Back to list</Link>
      </section>
    );
  }

  const isPoster = sameAddress(account, bounty.poster);
  const isHunter = sameAddress(account, bounty.hunter);
  const beforeDeadline = Date.now() / 1000 <= bounty.deadline;
  const canSubmit =
    bounty.status === BountyStatus.Open && beforeDeadline && account && !isPoster;

  return (
    <section>
      <div className="page-head">
        <h2>{bounty.title || `Bounty #${bounty.id}`}</h2>
        <StatusBadge status={bounty.status} />
      </div>

      <StatusTimeline status={bounty.status} />

      <div className="panel">
        <dl className="detail-grid">
          <div>
            <dt>Reward</dt>
            <dd>{formatEth(bounty.amount)} ETH</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>
              {formatTimestamp(bounty.deadline)}{" "}
              {bounty.status === BountyStatus.Open && <DeadlineCountdown deadline={bounty.deadline} />}
            </dd>
          </div>
          <div>
            <dt>Poster</dt>
            <dd title={bounty.poster}>{shortAddress(bounty.poster)}{isPoster && " (you)"}</dd>
          </div>
          <div>
            <dt>Hunter</dt>
            <dd title={bounty.hunter}>
              {bounty.status === BountyStatus.Open ? "—" : `${shortAddress(bounty.hunter)}${isHunter ? " (you)" : ""}`}
            </dd>
          </div>
          {bounty.status >= BountyStatus.Submitted && (
            <div>
              <dt>Submission hash</dt>
              <dd><code className="hash">{bounty.submissionHash}</code></dd>
            </div>
          )}
        </dl>
        {bounty.description && <p className="description">{bounty.description}</p>}
        {bounty.title == null && (
          <p className="muted">Title/description unavailable — backend metadata not reachable from this browser.</p>
        )}
      </div>

      {bounty.status >= BountyStatus.Submitted && (isPoster || isHunter) && (
        <div className="panel">
          <h3>Submission</h3>
          {submission ? (
            <>
              <pre className="submission-content">{submission.content}</pre>
              <p className="muted">
                {submission.verified
                  ? "Content hash verified against the on-chain submissionHash."
                  : "Warning: content hash does NOT match the on-chain submissionHash."}
              </p>
            </>
          ) : (
            <p className="muted">Submission text unavailable from this data source.</p>
          )}
        </div>
      )}

      {!account && bounty.status === BountyStatus.Open && (
        <div className="panel">
          <p className="muted">Connect your wallet to submit work{beforeDeadline ? "" : " (deadline passed)"}.</p>
          {beforeDeadline && <button className="btn btn-primary" onClick={connect}>Connect wallet</button>}
        </div>
      )}

      {canSubmit && <SubmitWorkForm bounty={bounty} onSubmitted={load} />}
      {isPoster && bounty.status === BountyStatus.Submitted && (
        <ApproveButton bounty={bounty} onDone={load} />
      )}
      {isPoster && bounty.status === BountyStatus.Open && (
        <CancelButton bounty={bounty} onDone={load} />
      )}

      <p><Link to="/">← Back to all bounties</Link></p>
    </section>
  );
}

/** Open → Submitted → Paid, with Cancelled as the alternate terminal state. */
function StatusTimeline({ status }) {
  const cancelled = status === BountyStatus.Cancelled;
  const steps = cancelled ? ["Open", "Cancelled"] : ["Open", "Submitted", "Paid"];
  const current = cancelled ? 1 : status;
  return (
    <ol className="timeline">
      {steps.map((name, i) => (
        <li key={name} className={i <= current ? "done" : ""}>
          <span className="timeline-dot" />
          {name}
        </li>
      ))}
    </ol>
  );
}
