import { NavLink, Route, Routes } from "react-router-dom";
import { IS_CONFIGURED } from "./lib/config.js";
import { WalletProvider, useWallet } from "./lib/WalletContext.jsx";
import { DataSourceProvider } from "./lib/DataSourceContext.jsx";
import WalletButton from "./components/WalletButton.jsx";
import DataSourceToggle from "./components/DataSourceToggle.jsx";
import BountyListPage from "./pages/BountyListPage.jsx";
import CreateBountyPage from "./pages/CreateBountyPage.jsx";
import BountyDetailPage from "./pages/BountyDetailPage.jsx";
import MyDashboardPage from "./pages/MyDashboardPage.jsx";

export default function App() {
  return (
    <WalletProvider>
      <DataSourceProvider>
        <Header />
        <GlobalBanners />
        <main className="container">
          <Routes>
            <Route path="/" element={<BountyListPage />} />
            <Route path="/bounties/new" element={<CreateBountyPage />} />
            <Route path="/bounties/:id" element={<BountyDetailPage />} />
            <Route path="/my" element={<MyDashboardPage />} />
            <Route path="*" element={<BountyListPage />} />
          </Routes>
        </main>
      </DataSourceProvider>
    </WalletProvider>
  );
}

function Header() {
  return (
    <header className="site-header">
      <NavLink to="/" className="brand">BountyVault</NavLink>
      <nav>
        <NavLink to="/" end>Bounties</NavLink>
        <NavLink to="/my">My dashboard</NavLink>
        <NavLink to="/bounties/new">New bounty</NavLink>
      </nav>
      <div className="header-actions">
        <DataSourceToggle />
        <WalletButton />
      </div>
    </header>
  );
}

function GlobalBanners() {
  const { account, isCorrectChain, switchChain, requiredChainId } = useWallet();
  return (
    <>
      {!IS_CONFIGURED && (
        <div className="banner banner-warning">
          VITE_CONTRACT_ADDRESS is not configured — copy frontend/.env.example to
          frontend/.env and set the deployed contract address.
        </div>
      )}
      {account && !isCorrectChain && (
        <div className="banner banner-warning">
          Your wallet is on the wrong network. This app requires chain {requiredChainId}.{" "}
          <button className="btn btn-outline btn-small" onClick={switchChain}>Switch network</button>
        </div>
      )}
    </>
  );
}
