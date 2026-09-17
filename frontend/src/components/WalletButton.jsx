import { useWallet } from "../lib/WalletContext.jsx";
import { shortAddress } from "../lib/wallet.js";

/** Connect button / connected account chip. */
export default function WalletButton() {
  const { account, walletAvailable, connecting, connect, error } = useWallet();

  if (!walletAvailable) {
    return (
      <a className="btn btn-outline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
        Install MetaMask
      </a>
    );
  }

  return (
    <span className="wallet-button">
      {account ? (
        <span className="account-chip" title={account}>
          {shortAddress(account)}
        </span>
      ) : (
        <button className="btn btn-primary" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}
