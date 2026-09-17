// Data-source selection (backend API vs. direct chain reads) with an "auto"
// mode that probes the backend health endpoint. The choice persists in
// localStorage so a developer's toggle survives reloads.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DATA_SOURCES, resolveDataSource } from "./data.js";

const STORAGE_KEY = "bv:dataSource";

const DataSourceContext = createContext(null);

export function DataSourceProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return DATA_SOURCES.includes(saved) ? saved : "auto";
    } catch {
      return "auto";
    }
  });
  const [source, setSource] = useState(null); // resolved: "backend" | "chain" | null (probing)

  const refresh = useCallback(async () => {
    setSource(null);
    setSource(await resolveDataSource(mode));
  }, [mode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setMode = useCallback((next) => {
    if (!DATA_SOURCES.includes(next)) return;
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // non-fatal
    }
  }, []);

  const value = useMemo(
    () => ({ mode, setMode, source, refresh }),
    [mode, setMode, source, refresh],
  );

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useDataSource() {
  const ctx = useContext(DataSourceContext);
  if (!ctx) throw new Error("useDataSource must be used inside <DataSourceProvider>");
  return ctx;
}
