# BountyVault — A Web3 Bounty & Escrow Platform

> **Outline status:** This README is the course-deliverable outline. Sections marked
> `TODO` are placeholders and will be completed as the corresponding components land;
> final pass is tracked in DAPP-5.

BountyVault is a decentralized task-bounty escrow platform built for COMP7610
(Introduction to Web3 and Blockchain). A **poster** creates a task bounty and locks
the reward in a smart contract on Ethereum. A **hunter** submits work — the
submission hash is anchored on-chain as tamper-proof proof, while the full content
is stored off-chain. When the poster accepts the work, the contract releases the
escrowed funds directly to the hunter; if nobody takes the task, the poster cancels
and gets a full refund. No platform can freeze, redirect, or delay the money — the
rules are code.

## Architecture

> **TODO:** embed an exported architecture diagram image here (e.g.
> `docs/assets/architecture.png`) once the components are implemented.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical
architecture (system diagram, contract design, backend API, frontend modules), and
[`docs/PRD.md`](docs/PRD.md) for the product scope and core flows F1–F4.

High level:

- **React frontend** — UI, wallet connection, and all user-initiated on-chain writes
  via Ethers.js v6 + MetaMask.
- **Solidity contract** — the only component that moves money; source of truth for
  bounty status, escrow, and submission hashes.
- **Node/Express backend** — stores off-chain metadata and full submission text in
  SQLite; indexes contract events so reads never hit the RPC node on the hot path.

On-chain vs off-chain split: *money, state, and proof hashes live on-chain; bulky or
private content (title, description, submission text) lives off-chain.*

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity `^0.8.24`, Hardhat, OpenZeppelin |
| Frontend | React + Vite, Ethers.js v6, React Router |
| Backend | Node.js + Express, SQLite (`better-sqlite3`) |
| Wallet / network | MetaMask, Sepolia testnet (chain ID `11155111`) |

## Repository Layout

```
bounty-vault/
├── contracts/                    # Hardhat project (TODO: scaffold pending)
│   ├── contracts/BountyVault.sol
│   ├── test/BountyVault.test.js  # state machine + boundary-rule tests
│   ├── scripts/deploy.js         # Sepolia deploy, prints address + block
│   ├── hardhat.config.js
│   └── .env.example
├── backend/                      # Express + SQLite API & event indexer (TODO: scaffold pending)
│   ├── src/index.js
│   ├── src/routes/
│   ├── src/db.js
│   ├── src/indexer.js
│   └── .env.example
├── frontend/                     # React + Vite SPA (TODO: scaffold pending)
│   ├── src/pages/
│   ├── src/components/
│   ├── src/lib/
│   └── .env.example
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── CONVENTIONS.md
└── README.md                     # this file
```

Directories marked TODO do not exist yet; the layout above is the agreed target
(see `docs/ARCHITECTURE.md` §5).

## Prerequisites

- Node.js LTS (>= 18) and npm
- A MetaMask browser wallet connected to the Sepolia testnet
- Sepolia test ETH for contract deployment and demo transactions (see faucets below)
- A Sepolia RPC endpoint (e.g. Alchemy or Infura) for deployment and the backend
  event indexer

## Setup & Run

All commands below are the conventional commands for this stack and may be adjusted
once each component's `package.json` lands (final pass: DAPP-5). Real `.env` files
are git-ignored; copy the committed `.env.example` template in each component and
fill in your own values.

### 1. Clone & configure

```bash
git clone https://github.com/DoctorLuoSH/bounty-vault.git
cd bounty-vault
```

### 2. Smart contracts (`contracts/`)

> **TODO:** section to be verified once the Hardhat scaffold lands.

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test                     # local unit tests
npx hardhat node                     # local chain (optional, for dev)
```

### 3. Backend (`backend/`)

> **TODO:** section to be verified once the Express scaffold lands.

```bash
cd backend
npm install
npm run dev                          # starts the API + event indexer (default :3001)
```

### 4. Frontend (`frontend/`)

> **TODO:** section to be verified once the Vite/React scaffold lands.

```bash
cd frontend
npm install
npm run dev                          # starts the SPA (default :5173)
```

## Sepolia Deployment & Faucets

> **TODO:** record the deployed contract address and deployment block here after the
> Week 3 Sepolia deployment.

Deployment (from `contracts/`, after filling in `contracts/.env`):

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script prints the contract address and deployment block; copy them into
`backend/.env` (`CONTRACT_ADDRESS`, `DEPLOYMENT_BLOCK`) and `frontend/.env`
(`VITE_CONTRACT_ADDRESS`).

Test ETH faucets for Sepolia (availability changes over time; any one is enough):

- Google Cloud Web3 faucet — <https://cloud.google.com/application/web3/faucet/ethereum/sepolia>
- Alchemy Sepolia faucet — <https://www.alchemy.com/faucets/ethereum-sepolia>
- MetaMask/Infura faucet — <https://www.infura.io/faucet/sepolia>
- Chainlink faucet — <https://faucets.chain.link/sepolia>

Keep bounty amounts tiny (0.001–0.01 ETH) so a single faucet run covers the whole
team's testing.

## Demo Script

> **TODO:** expand with exact click paths and timings once the UI is final; the demo
> video (<= 15 min, English) follows this outline.

End-to-end walkthrough with two MetaMask accounts (one poster, one hunter), matching
the four MVP flows in `docs/PRD.md`:

1. **F1 — Create & fund:** poster connects MetaMask (Sepolia), creates a bounty with
   reward + deadline; ETH is locked in escrow and the bounty appears as **Open**.
2. **F2 — Submit work:** hunter opens the bounty, submits result text; the
   submission hash is anchored on-chain, full text stored via the backend.
3. **F3 — Approve & pay:** poster reviews the submission and approves; the contract
   releases the escrow to the hunter (balance change visible in MetaMask).
4. **F4 — Cancel & refund:** on a second bounty with no submission, the poster
   cancels and the contract refunds the escrow.

## Team & Contribution

> **TODO:** fill in member names and the final contribution breakdown; the report
> PDF carries the authoritative contribution distribution.

| Member | Role |
|---|---|
| TBD | Contract lead |
| TBD | Backend lead |
| TBD | Frontend lead |
| TBD | Frontend / QA / report & video |

Development conventions (PR workflow, commit style, language rules) are documented
in [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

## License

MIT (a `LICENSE` file will be added before final submission — **TODO**).
