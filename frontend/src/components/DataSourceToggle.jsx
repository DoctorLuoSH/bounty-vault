import { useDataSource } from "../lib/DataSourceContext.jsx";

/** Toggle between backend API and direct chain reads (auto = probe backend). */
export default function DataSourceToggle() {
  const { mode, setMode, source, refresh } = useDataSource();
  return (
    <span className="datasource-toggle" title="Where list/detail data is read from">
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="auto">Auto</option>
        <option value="backend">Backend API</option>
        <option value="chain">On-chain</option>
      </select>
      <button
        className="btn btn-outline btn-small"
        onClick={refresh}
        title="Re-run the backend health probe"
      >
        {source === null ? "…" : source === "backend" ? "API" : "Chain"}
      </button>
    </span>
  );
}
