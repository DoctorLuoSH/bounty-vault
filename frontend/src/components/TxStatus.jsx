import { explorerTxUrl } from "../lib/format.js";

const PHASE_TEXT = {
  signing: "Confirm the transaction in MetaMask…",
  pending: "Transaction submitted, waiting for confirmation…",
  confirmed: "Transaction confirmed.",
};

/** Renders the lifecycle of an on-chain write from useTx(). */
export default function TxStatus({ txState }) {
  if (!txState || txState.phase === "idle") return null;

  if (txState.phase === "failed") {
    return (
      <p className="tx-status tx-failed" role="alert">
        {txState.message || "Transaction failed"}
        {txState.hash && <TxHash hash={txState.hash} />}
      </p>
    );
  }

  return (
    <p className={`tx-status tx-${txState.phase}`}>
      {PHASE_TEXT[txState.phase]}
      {txState.hash && <TxHash hash={txState.hash} />}
    </p>
  );
}

function TxHash({ hash }) {
  const url = explorerTxUrl(hash);
  const label = `${hash.slice(0, 10)}…`;
  return (
    <>
      {" "}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        <code>{label}</code>
      )}
    </>
  );
}
