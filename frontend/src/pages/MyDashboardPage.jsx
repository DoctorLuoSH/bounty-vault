import { useCallback, useEffect, useState } from "react";
import { loadBountyList } from "../lib/data.js";
import { useWallet } from "../lib/WalletContext.jsx";
import { useDataSource } from "../lib/DataSourceContext.jsx";
import { useReadContract } from "../lib/useReadContract.js";
import BountyCard from "../components/BountyCard.jsx";

/** `/my` — bounties posted by, and submissions made by, the connected account. */
export default function MyDashboardPage() {
  const { account, connect } = useWallet();
  const { source } = useDataSource();
  const readContract = useReadContract();
  const [posted, setPosted] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!account || !source) return;
    if (source === "chain" && !readContract) return;
    setError(null);
    try {
      const [asPoster, asHunter] = await Promise.all([
        loadBountyList({ source, readContract, poster: account }),
        loadBountyList({ source, readContract, hunter: account }),
      ]);
      setPosted(asPoster);
      setSubmitted(asHunter);
    } catch (err) {
      setError(err.message || "Failed to load dashboard");
    }
  }, [account, source, readContract]);

  useEffect(() => {
    load();
  }, [load]);

  if (!account) {
    return (
      <section className="panel">
        <h2>My dashboard</h2>
        <p className="muted">Connect your wallet to see your bounties and submissions.</p>
        <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
      </section>
    );
  }

  return (
    <section>
      <h2>My dashboard</h2>
      {error && (
        <p className="tx-status tx-failed">
          {error} <button className="btn btn-outline btn-small" onClick={load}>Retry</button>
        </p>
      )}
      <h3>My bounties (as poster)</h3>
      {posted === null ? (
        <p className="muted">Loading…</p>
      ) : posted.length === 0 ? (
        <p className="muted">You have not posted any bounty yet.</p>
      ) : (
        <div className="card-grid">{posted.map((b) => <BountyCard key={b.id} bounty={b} />)}</div>
      )}
      <h3>My submissions (as hunter)</h3>
      {submitted === null ? (
        <p className="muted">Loading…</p>
      ) : submitted.length === 0 ? (
        <p className="muted">You have not submitted work yet.</p>
      ) : (
        <div className="card-grid">{submitted.map((b) => <BountyCard key={b.id} bounty={b} />)}</div>
      )}
    </section>
  );
}
