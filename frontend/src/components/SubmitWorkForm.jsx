import { useState } from "react";
import { getBrowserProvider } from "../lib/wallet.js";
import { getWriteContract, computeSubmissionHash, parseEventFromReceipt } from "../lib/contract.js";
import { apiPostSubmission } from "../lib/api.js";
import { saveSubmission } from "../lib/localStore.js";
import { useWallet } from "../lib/WalletContext.jsx";
import { useTx } from "../lib/useTx.js";
import TxStatus from "./TxStatus.jsx";

/**
 * Hunter's submission form. Hashes the raw content per docs/ARCHITECTURE.md
 * §2.7 (no trimming), anchors the hash on-chain, then stores the full text via
 * the backend (falling back to a browser-local copy while it is unavailable).
 */
export default function SubmitWorkForm({ bounty, onSubmitted }) {
  const { account } = useWallet();
  const [content, setContent] = useState("");
  const [note, setNote] = useState(null);
  const { txState, run } = useTx();

  const busy = txState.phase === "signing" || txState.phase === "pending";

  async function handleSubmit(e) {
    e.preventDefault();
    setNote(null);
    if (!content) return;
    const submissionHash = computeSubmissionHash(content);
    const signer = await getBrowserProvider().getSigner();
    const contract = getWriteContract(signer);
    await run(() => contract.submitWork(bounty.id, submissionHash), {
      onConfirmed: async (receipt, tx) => {
        const record = {
          content,
          hunterAddress: account,
          submitTxHash: tx.hash,
          submittedAt: new Date().toISOString(),
        };
        saveSubmission(bounty.id, record);
        // Parse WorkSubmitted from the receipt for immediate confirmation that
        // the anchored hash matches what we computed locally.
        const args = parseEventFromReceipt(receipt, "WorkSubmitted");
        const anchored = args?.submissionHash;
        let note =
          anchored && anchored.toLowerCase() === submissionHash.toLowerCase()
            ? "Submission anchored on-chain; hash matches the local content."
            : null;
        try {
          await apiPostSubmission(bounty.id, record);
        } catch {
          note = `${note ? `${note} ` : ""}The backend is unreachable, so the full text is cached in this browser only.`;
        }
        if (note) setNote(note);
        onSubmitted?.(receipt);
      },
    });
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h3>Submit your work</h3>
      <p className="muted">
        Only the keccak256 hash of the exact text goes on-chain; the full text is
        stored off-chain for the poster.
      </p>
      <textarea
        rows={6}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste the deliverable (link, text, …) exactly as it should be hashed"
        disabled={busy}
        required
      />
      <button className="btn btn-primary" type="submit" disabled={busy || !content}>
        {busy ? "Submitting…" : "Submit work"}
      </button>
      <TxStatus txState={txState} />
      {note && <p className="tx-status tx-pending">{note}</p>}
    </form>
  );
}
