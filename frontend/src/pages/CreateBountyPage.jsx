import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseEther } from "ethers";
import { getBrowserProvider } from "../lib/wallet.js";
import { getWriteContract, parseEventFromReceipt } from "../lib/contract.js";
import { apiPostBounty } from "../lib/api.js";
import { saveBountyMeta } from "../lib/localStore.js";
import { useWallet } from "../lib/WalletContext.jsx";
import { useTx } from "../lib/useTx.js";
import TxStatus from "../components/TxStatus.jsx";

/** `/bounties/new` — create a bounty; the reward is locked on-chain (payable). */
export default function CreateBountyPage() {
  const navigate = useNavigate();
  const { account, isCorrectChain, connect } = useWallet();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("");
  const [deadlineLocal, setDeadlineLocal] = useState("");
  const [formError, setFormError] = useState(null);
  const [note, setNote] = useState(null);
  const { txState, run } = useTx();

  const busy = txState.phase === "signing" || txState.phase === "pending";

  function validate() {
    if (!title.trim()) return "Title is required.";
    if (!description.trim()) return "Description is required.";
    let value;
    try {
      value = parseEther(reward);
    } catch {
      return "Reward must be a valid ETH amount.";
    }
    if (value <= 0n) return "Reward must be greater than 0 ETH.";
    const deadlineSec = Math.floor(new Date(deadlineLocal).getTime() / 1000);
    if (!Number.isFinite(deadlineSec) || deadlineSec <= Math.floor(Date.now() / 1000)) {
      return "Deadline must be in the future.";
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setNote(null);
    const invalid = validate();
    if (invalid) {
      setFormError(invalid);
      return;
    }
    const deadlineSec = Math.floor(new Date(deadlineLocal).getTime() / 1000);
    const signer = await getBrowserProvider().getSigner();
    const contract = getWriteContract(signer);
    await run(() => contract.createBounty(deadlineSec, { value: parseEther(reward) }), {
      onConfirmed: async (receipt, tx) => {
        // Parse BountyCreated from the receipt for immediate feedback (the new id).
        const args = parseEventFromReceipt(receipt, "BountyCreated");
        const bountyId = args ? Number(args.bountyId) : null;
        const meta = {
          title: title.trim(),
          description: description.trim(),
          posterAddress: account,
          createTxHash: tx.hash,
          createdAt: new Date().toISOString(),
        };
        if (bountyId !== null) {
          saveBountyMeta(bountyId, meta);
          try {
            await apiPostBounty({ onChainId: bountyId, ...meta });
          } catch {
            setNote("Bounty created on-chain; the backend is unreachable, so title/description are cached in this browser only.");
          }
          navigate(`/bounties/${bountyId}`);
        } else {
          navigate("/");
        }
      },
    });
  }

  if (!account) {
    return (
      <section className="panel">
        <h2>Create bounty</h2>
        <p className="muted">Connect your wallet to create a bounty.</p>
        <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Create bounty</h2>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} required />
        </label>
        <label>
          Description
          <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} required />
        </label>
        <label>
          Reward (ETH)
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0.01"
            value={reward}
            onChange={(e) => setReward(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        <label>
          Deadline
          <input
            type="datetime-local"
            value={deadlineLocal}
            onChange={(e) => setDeadlineLocal(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !isCorrectChain}>
          {busy ? "Creating…" : "Create & lock reward"}
        </button>
        {!isCorrectChain && <p className="muted">Switch to the required network to continue.</p>}
        {formError && <p className="tx-status tx-failed">{formError}</p>}
        <TxStatus txState={txState} />
        {note && <p className="tx-status tx-pending">{note}</p>}
      </form>
    </section>
  );
}
