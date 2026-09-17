import { getBrowserProvider } from "../lib/wallet.js";
import { getWriteContract } from "../lib/contract.js";
import { useTx } from "../lib/useTx.js";
import TxStatus from "./TxStatus.jsx";

/** Poster action: cancel an Open bounty and refund the escrow (before or after the deadline). */
export default function CancelButton({ bounty, onDone }) {
  const { txState, run } = useTx();
  const busy = txState.phase === "signing" || txState.phase === "pending";

  async function handleCancel() {
    if (!window.confirm("Cancel this bounty and refund the escrow to your wallet?")) return;
    const signer = await getBrowserProvider().getSigner();
    const contract = getWriteContract(signer);
    await run(() => contract.cancelBounty(bounty.id), {
      onConfirmed: (receipt) => onDone?.(receipt),
    });
  }

  return (
    <div className="panel">
      <h3>Cancel bounty</h3>
      <p className="muted">
        Possible while no submission exists. The full escrow returns to your wallet.
      </p>
      <button className="btn btn-danger" onClick={handleCancel} disabled={busy}>
        {busy ? "Cancelling…" : "Cancel & refund"}
      </button>
      <TxStatus txState={txState} />
    </div>
  );
}
