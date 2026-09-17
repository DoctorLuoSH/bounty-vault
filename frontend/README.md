# BountyVault Frontend

React SPA for the BountyVault task-bounty escrow platform
(`docs/ARCHITECTURE.md` §4). Stack: Vite + React 18 + React Router +
Ethers.js v6 + MetaMask.

## Setup

```bash
npm install
cp .env.example .env   # then fill in VITE_CONTRACT_ADDRESS
```

| Env var | Meaning |
|---|---|
| `VITE_CONTRACT_ADDRESS` | Deployed `BountyVault` address (from `contracts/scripts/deploy.js`). Required for any on-chain read/write. |
| `VITE_CHAIN_ID` | Chain the wallet must use. `11155111` (Sepolia, default) or `31337` (local Hardhat node). |
| `VITE_BACKEND_URL` | Backend API base (`/api` is appended). Default `http://localhost:3001`. |

## Run

```bash
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## Pages

- `/` — all bounties with a status filter (Open default)
- `/bounties/new` — create a bounty (payable `createBounty`, reward locked in escrow)
- `/bounties/:id` — status timeline + role-based actions: hunters submit work
  (Open, before deadline), posters review the submission and approve (Submitted)
  or cancel (Open)
- `/my` — the connected account's bounties (as poster) and submissions (as hunter)

## Data source: backend vs. chain

List/detail data is read through `src/lib/data.js` with three modes (header
toggle, persisted in localStorage):

- **Auto** (default) — probe `GET /api/health`; use the backend when it answers,
  otherwise read the contract directly.
- **Backend API** — force the backend (`docs/ARCHITECTURE.md` §3.2).
- **On-chain** — force direct contract reads (`bountyCount` + `getBounty`).

On-chain state (status, amounts, hashes) always comes from the contract. While
the backend is unavailable, bounty metadata and full submission text are cached
in the browser's localStorage (write-through: the backend is still written
first when reachable), so all four flows stay usable end-to-end.

## Conventions

- `src/lib/contract.js` is the only contract abstraction — components never
  inline ABI fragments. The ABI lives in `src/lib/abi.js` and must match
  `contracts/contracts/BountyVault.sol` (checked by the e2e script).
- Submission hashing follows `docs/ARCHITECTURE.md` §2.7:
  `keccak256(toUtf8Bytes(content))` on the raw input, no trimming.
- All writes go through MetaMask signing; the app holds no keys. Receipt events
  (`BountyCreated`, `WorkSubmitted`, …) are parsed for immediate UI feedback and
  the affected data is refetched after confirmation.

## Local end-to-end check

Verifies the app's contract/data layer against a fresh local deployment,
walking PRD flows F1–F4 (create, submit, approve, cancel):

```bash
cd ../contracts && npx hardhat node   # leave running
cd ../frontend && npm run test:e2e
```

For a full browser run-through on the local node: set `VITE_CHAIN_ID=31337` and
`VITE_CONTRACT_ADDRESS` (deploy with `npx hardhat run scripts/deploy.js` against
the local node or copy the address printed by `test:e2e`), then add network
"Localhost 8545" (chain id 31337) in MetaMask and import one of the Hardhat
test accounts.
