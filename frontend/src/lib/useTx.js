// Shared transaction lifecycle hook: idle -> signing -> pending -> confirmed,
// or -> failed with a decoded message. `run` takes a factory so the signing
// phase is captured before the tx is broadcast.
import { useCallback, useState } from "react";
import { describeTxError } from "./contract.js";

export function useTx() {
  const [txState, setTxState] = useState({ phase: "idle" });

  const run = useCallback(async (sendTx, { onConfirmed } = {}) => {
    setTxState({ phase: "signing" });
    let tx;
    try {
      tx = await sendTx();
    } catch (err) {
      setTxState({ phase: "failed", message: describeTxError(err) });
      return null;
    }
    setTxState({ phase: "pending", hash: tx.hash });
    try {
      const receipt = await tx.wait();
      if (receipt.status === 0) throw new Error("Transaction reverted on-chain");
      setTxState({ phase: "confirmed", hash: tx.hash });
      if (onConfirmed) await onConfirmed(receipt, tx);
      return receipt;
    } catch (err) {
      setTxState({ phase: "failed", hash: tx.hash, message: describeTxError(err) });
      return null;
    }
  }, []);

  const reset = useCallback(() => setTxState({ phase: "idle" }), []);

  return { txState, run, reset };
}
