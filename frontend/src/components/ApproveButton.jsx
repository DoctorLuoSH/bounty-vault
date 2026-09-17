import { getBrowserProvider } from "../lib/wallet.js";
import { getWriteContract } from "../lib/contract.js";
import { useTx } from "../lib/useTx.js";
import TxStatus from "./TxStatus.jsx";

/** Poster action: accept the submission; the escrow pays out to the hunter. */
export default function ApproveButton({ bounty, onDone }) {
  const { txState, run } = useTx();
  const busy = txState.phase === "signing" || txState.phase === "pending";

  async function handleApprove() {
    const signer = await getBrowserProvider().getSigner();
    const contract = getWriteContract(signer);
    await run(() => contract.approveSubmission(bounty.id), {
      onConfirmed: (receipt) => onDone?.(receipt),
    });
  }

  return (
    <div className="panel">
      <h3>Accept submission</h3>
      <p className="muted">
        Releases the full escrow of the bounty to the hunter. This cannot be undone.
      </p>
      <button className="btn btn-primary" onClick={handleApprove} disabled={busy}>
        {busy ? "Approving…" : "Approve & pay"}
      </button>
      <TxStatus txState={txState} />
    </div>
  );
}
