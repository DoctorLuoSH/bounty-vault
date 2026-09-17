# BountyVault — A Web3 Bounty & Escrow Platform

BountyVault is a decentralized task-bounty escrow platform built for COMP7610
(Introduction to Web3 and Blockchain). A **poster** creates a task bounty and locks
the reward in a smart contract on Ethereum. A **hunter** submits work — the
submission hash is anchored on-chain as tamper-proof proof, while the full content
is stored off-chain. When the poster accepts the work, the contract releases the
escrowed funds directly to the hunter; if nobody takes the task, the poster cancels
and gets a full refund. No platform can freeze, redirect, or delay the money — the
rules are code.

The contract is deployed and verified end-to-end on the **Sepolia testnet**; see
[Sepolia Deployment](#sepolia-deployment) for the address, transaction hashes, and
seeded demo data.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          User (browser)                          │
│  ┌──────────────────────┐        ┌────────────────────────────┐  │
│  │  React SPA (Vite)    │        │  MetaMask (wallet, signer) │  │
│  │  - pages & forms     │◄──────►│  - signs txs               │  │
│  │  - Ethers.js v6      │        │  - Sepolia network         │  │
│  └───────┬──────────────┘        └─────────────┬──────────────┘  │
└──────────┼─────────────────────────────────────┼────────────────┘
           │ JSON-RPC / REST                     │ signed txs
           ▼                                     ▼
┌─────────────────────────┐          ┌─────────────────────────────┐
│  Backend (Node/Express) │  events  │  Sepolia testnet            │
│  - REST API             │◄────────►│  ┌───────────────────────┐  │
│  - event indexer        │  (poll/  │  │ BountyVault.sol       │  │
│  - SQLite               │   RPC)   │  │ escrow + state machine│  │
└─────────────────────────┘          │  └───────────────────────┘  │
                                     └─────────────────────────────┘
```

- **React frontend** — UI, wallet connection, and all user-initiated on-chain writes
  via Ethers.js v6 + MetaMask. The app holds no keys.
- **Solidity contract** — the only component that moves money; source of truth for
  bounty status, escrow, and submission hashes.
- **Node/Express backend** — stores off-chain metadata and full submission text in
  SQLite; indexes contract events so reads never hit the RPC node on the hot path.

On-chain vs off-chain split: *money, state, and proof hashes live on-chain; bulky or
private content (title, description, submission text) lives off-chain.*

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical
architecture (contract design incl. boundary rules R1–R8, backend API, indexer
policy, frontend modules), and [`docs/PRD.md`](docs/PRD.md) for the product scope
and core flows F1–F4.

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity `^0.8.24`, Hardhat 2, OpenZeppelin 5 |
| Frontend | React 18 + Vite 5, Ethers.js v6, React Router 6 |
| Backend | Node.js + Express 4, SQLite (`better-sqlite3`) |
| Wallet / network | MetaMask, Sepolia testnet (chain ID `11155111`) |

## Repository Layout

```
bounty-vault/
├── contracts/                    # Hardhat project
│   ├── contracts/BountyVault.sol
│   ├── contracts/mocks/          # test helpers (e.g. RejectingReceiver)
│   ├── test/BountyVault.test.js  # state machine + R1–R8 boundary-rule tests
│   ├── scripts/deploy.js         # Sepolia deploy; prints address + block + tx
│   ├── hardhat.config.js
│   └── .env.example
├── backend/                      # Express + SQLite API & event indexer
│   ├── src/index.js              # bootstrap (API + indexer)
│   ├── src/routes/               # bounties + submissions REST endpoints
│   ├── src/db.js                 # schema + migrations
│   ├── src/indexer.js            # eth_getLogs polling loop
│   ├── test/                     # API & indexer tests (node:test)
│   └── .env.example
├── frontend/                     # React + Vite SPA
│   ├── src/pages/                # list / create / detail / my-dashboard
│   ├── src/components/
│   ├── src/lib/                  # wallet, contract, data source, API client
│   ├── scripts/e2e-local.mjs     # local end-to-end check of flows F1–F4
│   └── .env.example
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── CONVENTIONS.md            # team workflow (Chinese)
└── README.md                     # this file
```

## Prerequisites

- **Node.js >= 18 LTS** and npm (developed and verified on Node 22; the backend
  declares `engines.node >= 18` and Hardhat requires 18+).
- **MetaMask** browser extension with two accounts you control (one plays the
  poster, one the hunter in the demo).
- **Sepolia test ETH** in at least one account (deployment + demo transactions).
  Keep bounty amounts tiny (0.001–0.01 ETH) so one faucet run covers everything:
  - Google Cloud Web3 faucet — <https://cloud.google.com/application/web3/faucet/ethereum/sepolia>
  - Alchemy Sepolia faucet — <https://www.alchemy.com/faucets/ethereum-sepolia>
  - MetaMask/Infura faucet — <https://www.infura.io/faucet/sepolia>
  - Chainlink faucet — <https://faucets.chain.link/sepolia>
- **A Sepolia RPC endpoint** (e.g. a free Alchemy or Infura API key) for contract
  deployment and the backend event indexer.

Real `.env` files are git-ignored everywhere; each component ships a committed
`.env.example` template — copy it to `.env` and fill in your own values.

## Setup & Run

### 1. Clone

```bash
git clone https://github.com/DoctorLuoSH/bounty-vault.git
cd bounty-vault
```

### 2. Smart contracts (`contracts/`)

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test                     # unit tests: state machine + rules R1–R8
```

To deploy your own instance (skip to use the already-deployed Sepolia contract
below): copy `contracts/.env.example` to `contracts/.env`, fill in
`SEPOLIA_RPC_URL` and `PRIVATE_KEY` (Sepolia test account only — never commit a
real key), then:

```bash
npm run deploy:sepolia               # prints contract address, tx hash, block
```

The deploy script prints the contract address and deployment block; copy them into
`backend/.env` (`CONTRACT_ADDRESS`, `DEPLOYMENT_BLOCK`) and `frontend/.env`
(`VITE_CONTRACT_ADDRESS`).

### 3. Backend (`backend/`)

```bash
cd backend
npm install
cp .env.example .env                 # then fill in RPC_URL, CONTRACT_ADDRESS, DEPLOYMENT_BLOCK
npm start                            # API on http://localhost:3001 + event indexer
npm test                             # API & indexer tests (node:test)
```

Key env vars (`backend/.env.example`): `RPC_URL` (Sepolia endpoint for the
indexer), `CONTRACT_ADDRESS` + `DEPLOYMENT_BLOCK` (from the deploy step),
`INDEXER_CONFIRMATIONS` (reorg safety, default 12). Leave `CONTRACT_ADDRESS`
empty to run the API without indexing.

### 4. Frontend (`frontend/`)

```bash
cd frontend
npm install
cp .env.example .env                 # then fill in VITE_CONTRACT_ADDRESS
npm run dev                          # SPA on http://localhost:5173
npm run build                        # production build into dist/
```

Key env vars (`frontend/.env.example`): `VITE_CONTRACT_ADDRESS`,
`VITE_CHAIN_ID=11155111` (Sepolia; `31337` targets a local Hardhat node),
`VITE_BACKEND_URL=http://localhost:3001`. When the backend is unreachable the app
falls back to reading the contract directly — see the data-source toggle in the
header and `frontend/README.md` for details.

### 5. (Optional) local end-to-end check without Sepolia

```bash
cd contracts && npx hardhat node     # leave running
cd frontend && npm run test:e2e      # deploys locally and walks flows F1–F4
```

## Sepolia Deployment

Deployed from `main` @ `12ca639` on 2026-09-17 with the team's shared test
account.

| Item | Value |
|---|---|
| Contract address | [`0x9dD555CB8962D4c89e1331DBCE5D470370ae60a7`](https://sepolia.etherscan.io/address/0x9dD555CB8962D4c89e1331DBCE5D470370ae60a7) |
| Deployment tx | [`0xbc6d53a16fd8c4cfa776c9c655d2f0657fa2fc3db7b69464048011f17564038e`](https://sepolia.etherscan.io/tx/0xbc6d53a16fd8c4cfa776c9c655d2f0657fa2fc3db7b69464048011f17564038e) |
| Deployment block | `11722527` (use as `DEPLOYMENT_BLOCK`) |
| Deployer (team test account) | `0x4D986914C39a07e292E3A9194346be75Fb6C4E4D` |
| Network | Sepolia, chain ID `11155111` |

### Seeded demo data (live on Sepolia)

Three bounties were created on the deployed contract (amounts kept ≤ 0.01 ETH per
bounty so the whole demo costs a fraction of one faucet run):

| On-chain ID | Title | Amount | Status | Flow demonstrated |
|---|---|---|---|---|
| 0 | Design the BountyVault landing-page hero section | 0.005 ETH | **Paid** | F1 → F2 → F3 (create, submit, approve) |
| 1 | Write Hardhat tests for indexer reorg edge cases | 0.003 ETH | **Cancelled** | F1 → F4 (create, cancel & refund) |
| 2 | Record a 30-second GIF of the wallet-connect flow | 0.002 ETH | **Open** | open bounty for live demos |

Corresponding transactions (verifiable on Sepolia Etherscan):

- Create bounty 0: `0x3623bf66e6bc6a48290b102450c98e7fd99ac0ba5c309d5dcc2086fdb47d60e4`
- Submit work (hunter `0x06D1A8435c8adD570909308557cf3808813Ef8fA`): `0x6451dd92d079eee6bfc6e46b07782c831bd7d2898b178e5c3643af55e029d56b`
- Approve & pay: `0x3b412fea14231db341617f04c54666c4290371d16aad1c8ae5e2749d328dc220`
- Create bounty 1: `0xec0b125ac2a1afca121b1a7a915f056e1f6f365d9460c668d12af4dbfa0e7075`
- Cancel & refund: `0x6b3ed4a5b135074d7b0590019d57ae43ca3bbc8a1a8e7d7375d626f9a45ca2e8`
- Create bounty 2: `0xde7e13a302a8856e9bf9b68fba6072b3938c3f6f1569c19a924f65e0c082840a`

The matching off-chain metadata (titles, descriptions, submission text) lives in
the backend's SQLite database and is seeded through the REST API
(`POST /api/bounties`, `POST /api/bounties/:id/submissions`); the indexer confirms
each row against the on-chain events.

## Demo Script

End-to-end walkthrough with two MetaMask accounts on Sepolia (one **poster**, one
**hunter**), matching the four MVP flows in `docs/PRD.md`. Start the backend
(step 3) and frontend (step 4), open <http://localhost:5173>.

1. **F1 — Create & fund (poster).** Click **Connect wallet**, approve in MetaMask
   (the app prompts **Switch network** if MetaMask is not on Sepolia). Open
   **New bounty**, fill in title, description, reward (e.g. 0.005 ETH) and
   deadline, then **Create bounty** and confirm the payable transaction. After
   confirmation the detail page shows status **Open** and the reward is locked in
   the contract.
2. **F2 — Submit work (hunter).** Switch MetaMask to the second account, open the
   bounty from the **Bounties** list, paste the deliverable text into
   **Submit your work** and confirm. The app anchors `keccak256(text)` on-chain
   (`WorkSubmitted`) and stores the full text via the backend; the bounty flips to
   **Submitted**.
3. **F3 — Approve & pay (poster).** Switch back to the poster account, open the
   bounty, read the submission (visible only to poster and hunter), and click
   **Accept submission**. The contract transfers the full escrow to the hunter —
   status becomes **Paid** and the hunter's MetaMask balance increases.
4. **F4 — Cancel & refund (poster).** Create a second bounty, then (before anyone
   submits) click **Cancel bounty** on its detail page. The escrow is refunded to
   the poster and the status becomes **Cancelled**.

The **My dashboard** page lists the connected account's bounties and submissions;
every confirmed wallet transaction renders a receipt panel with a Sepolia
Etherscan link.

## Team & Contribution

| Member | Role |
|---|---|
| TBD | Contract lead |
| TBD | Backend lead |
| TBD | Frontend lead |
| TBD | Frontend / QA / report & video |

The authoritative contribution distribution is documented in the project report
PDF (course deliverable, due 2026-11-08). Development conventions (PR workflow,
commit style, language rules) are documented in
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## License

MIT (a `LICENSE` file will be added before final submission).
