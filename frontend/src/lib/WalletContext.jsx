// React binding over lib/wallet.js: tracks the connected account and chain,
// subscribes to MetaMask events, and exposes connect/switch actions.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CHAIN_ID } from "./config.js";
import {
  connectWallet,
  getChainId,
  getConnectedAccount,
  hasWallet,
  subscribeWalletEvents,
  switchToRequiredChain,
} from "./wallet.js";
import { describeTxError } from "./contract.js";

const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!hasWallet()) return undefined;
    getConnectedAccount()
      .then((acc) => acc && setAccount(acc))
      .catch(() => {});
    getChainId()
      .then(setChainId)
      .catch(() => {});
    return subscribeWalletEvents({
      onAccountsChanged: (accounts) => setAccount(accounts[0] || null),
      onChainChanged: setChainId,
    });
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { account: acc, chainId: cid } = await connectWallet();
      setAccount(acc);
      setChainId(cid);
    } catch (err) {
      setError(describeTxError(err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchChain = useCallback(async () => {
    setError(null);
    try {
      await switchToRequiredChain();
      setChainId(await getChainId());
    } catch (err) {
      setError(describeTxError(err));
    }
  }, []);

  const value = useMemo(
    () => ({
      account,
      chainId,
      requiredChainId: CHAIN_ID,
      isCorrectChain: chainId === CHAIN_ID,
      walletAvailable: hasWallet(),
      connecting,
      error,
      connect,
      switchChain,
    }),
    [account, chainId, connecting, error, connect, switchChain],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
