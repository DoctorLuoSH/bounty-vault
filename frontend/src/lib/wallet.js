// MetaMask / EIP-1193 wallet glue (docs/ARCHITECTURE.md §4.2).
// Framework-free: React bindings live in WalletContext.jsx.
import { BrowserProvider, JsonRpcProvider } from "ethers";
import { CHAIN_ID, CHAIN_ID_HEX } from "./config.js";

/** Public RPC endpoints used for reads when no wallet is available/connected. */
const DEFAULT_RPC_URLS = {
  11155111: "https://rpc.sepolia.org",
  31337: "http://127.0.0.1:8545",
};

/** True when an EIP-1193 provider (MetaMask) is injected. */
export function hasWallet() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

/** BrowserProvider wrapping window.ethereum. A fresh instance is cheap. */
export function getBrowserProvider() {
  if (!hasWallet()) throw new Error("MetaMask is not installed");
  return new BrowserProvider(window.ethereum);
}

/**
 * Request accounts and make sure the wallet is on the required chain.
 * Returns { account, chainId } (account is null when the user has none).
 */
export async function connectWallet() {
  const provider = getBrowserProvider();
  const accounts = await provider.send("eth_requestAccounts", []);
  const chainId = await ensureRequiredChain(provider);
  return { account: accounts[0] || null, chainId };
}

/** Silent reconnect for returning users (no popup). */
export async function getConnectedAccount() {
  const provider = getBrowserProvider();
  const accounts = await provider.send("eth_accounts", []);
  return accounts[0] || null;
}

/** Current chainId as a number. */
export async function getChainId(provider = getBrowserProvider()) {
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

/**
 * Provider for read-only calls. Prefers the injected wallet when it is on the
 * required chain; otherwise falls back to the public RPC for CHAIN_ID so list
 * pages keep working while the wallet is on the wrong network (or absent).
 */
export function getReadProvider(currentChainId) {
  if (hasWallet() && currentChainId === CHAIN_ID) return getBrowserProvider();
  const url = DEFAULT_RPC_URLS[CHAIN_ID];
  if (!url) throw new Error(`No public RPC configured for chain ${CHAIN_ID}`);
  return new JsonRpcProvider(url);
}

/** Ensure the wallet is on CHAIN_ID; prompts a switch (and add) otherwise. */
export async function ensureRequiredChain(provider = getBrowserProvider()) {
  const chainId = await getChainId(provider);
  if (chainId === CHAIN_ID) return chainId;
  await switchToRequiredChain();
  return CHAIN_ID;
}

/** Ask MetaMask to switch to the required chain, adding it if unknown. */
export async function switchToRequiredChain() {
  const ethereum = window.ethereum;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (err) {
    // 4902: the chain has not been added to MetaMask yet.
    if (err && err.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [chainParams()],
      });
    } else {
      throw err;
    }
  }
}

function chainParams() {
  if (CHAIN_ID === 11155111) {
    return {
      chainId: CHAIN_ID_HEX,
      chainName: "Sepolia",
      nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://rpc.sepolia.org"],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    };
  }
  if (CHAIN_ID === 31337) {
    return {
      chainId: CHAIN_ID_HEX,
      chainName: "Localhost 8545",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["http://127.0.0.1:8545"],
    };
  }
  return {
    chainId: CHAIN_ID_HEX,
    chainName: `Chain ${CHAIN_ID}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [],
  };
}

/**
 * Subscribe to MetaMask account/chain changes.
 * Returns an unsubscribe function.
 */
export function subscribeWalletEvents({ onAccountsChanged, onChainChanged }) {
  if (!hasWallet()) return () => {};
  const ethereum = window.ethereum;
  const handleAccounts = (accounts) => onAccountsChanged(accounts);
  const handleChain = (chainIdHex) => onChainChanged(Number(BigInt(chainIdHex)));
  ethereum.on("accountsChanged", handleAccounts);
  ethereum.on("chainChanged", handleChain);
  return () => {
    ethereum.removeListener("accountsChanged", handleAccounts);
    ethereum.removeListener("chainChanged", handleChain);
  };
}

/** 0x1234…abcd short form for display. */
export function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Case-insensitive address comparison (backend stores lowercase). */
export function sameAddress(a, b) {
  return Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
}
