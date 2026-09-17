// Hook bundling provider selection + read-contract construction for pages.
import { useMemo } from "react";
import { getReadProvider } from "./wallet.js";
import { getReadContract } from "./contract.js";
import { useWallet } from "./WalletContext.jsx";

/**
 * Returns a read-only contract bound to the best available provider, or null
 * when neither a correctly-chained wallet nor a public RPC is usable.
 */
export function useReadContract() {
  const { chainId } = useWallet();
  return useMemo(() => {
    try {
      return getReadContract(getReadProvider(chainId));
    } catch {
      return null;
    }
  }, [chainId]);
}
