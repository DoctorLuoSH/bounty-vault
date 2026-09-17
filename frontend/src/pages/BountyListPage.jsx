import { useCallback, useEffect, useState } from "react";
import { loadBountyList } from "../lib/data.js";
import { STATUS_KEYS } from "../lib/contract.js";
import { useDataSource } from "../lib/DataSourceContext.jsx";
import { useReadContract } from "../lib/useReadContract.js";
import BountyCard from "../components/BountyCard.jsx";

const FILTERS = ["open", "submitted", "paid", "cancelled", "all"];

/** `/` — all bounties with a status filter (open by default). */
export default function BountyListPage() {
  const { source } = useDataSource();
  const readContract = useReadContract();
  const [status, setStatus] = useState("open");
  const [bounties, setBounties] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!source) return;
    if (source === "chain" && !readContract) return;
    setError(null);
    try {
      const list = await loadBountyList({
        source,
        readContract,
        status: status === "all" ? undefined : status,
      });
      setBounties(list);
    } catch (err) {
      setError(err.message || "Failed to load bounties");
      setBounties([]);
    }
  }, [source, readContract, status]);

  useEffect(() => {
    setBounties(null);
    load();
  }, [load]);

  return (
    <section>
      <div className="page-head">
        <h2>Bounties</h2>
        <div className="filter-tabs">
          {FILTERS.map((key) => (
            <button
              key={key}
              className={`filter-tab ${status === key ? "active" : ""}`}
              onClick={() => setStatus(key)}
            >
              {key === "all" ? "All" : STATUS_KEYS.includes(key) ? key[0].toUpperCase() + key.slice(1) : key}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="tx-status tx-failed">
          {error} <button className="btn btn-outline btn-small" onClick={load}>Retry</button>
        </p>
      )}
      {source === null && <p className="muted">Probing data source…</p>}
      {bounties === null && !error && source !== null && <p className="muted">Loading…</p>}
      {bounties && bounties.length === 0 && !error && <p className="muted">No bounties found.</p>}
      <div className="card-grid">
        {bounties?.map((bounty) => <BountyCard key={bounty.id} bounty={bounty} />)}
      </div>
    </section>
  );
}
