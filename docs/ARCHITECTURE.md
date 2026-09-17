# BountyVault — Technical Architecture

**Companion document:** `docs/PRD.md` (product scope, flows F1–F4).
Precision target of this document: contract, frontend, and backend can be developed
in parallel against the interfaces defined here.

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          User (browser)                          │
│  ┌──────────────────────┐        ┌────────────────────────────┐  │
│  │  React SPA (Vite)    │        │  MetaMask (wallet, signer) │  │
│  │  - pages & forms     │◄──────►│  - signs txs               │  │
│  │  - Ethers.js v6      │        │  - Sepolia network         │  │
│  └───────┬──────────────┘        └─────────────┬──────────────┘  │
└──────────┼─────────────────────────────────────┼────────────────┘
           │ JSON-RPC (via MetaMask provider)    │ signed txs
           ▼                                     ▼
┌─────────────────────────┐          ┌─────────────────────────────┐
│  Backend (Node/Express) │  events  │  Sepolia testnet            │
│  - REST API             │◄────────►│  ┌───────────────────────┐  │
│  - event indexer        │  (poll/  │  │ BountyVault.sol       │  │
│  - SQLite               │   RPC)   │  │ escrow + state machine│  │
└─────────────────────────┘          │  └───────────────────────┘  │
                                     └─────────────────────────────┘
```

- **React frontend** — UI, wallet connection, all user-initiated on-chain writes via
  Ethers.js v6 (`BrowserProvider` wrapping `window.ethereum`).
- **Solidity contract** — the only component that moves money; source of truth for
  bounty status, escrow, submission hashes.
- **Node/Express backend** — stores off-chain metadata and full submission text in
  SQLite; indexes contract events over JSON-RPC so list/detail pages are cheap.
- **MetaMask** — identity and signing; no server-side keys, no user passwords.

On-chain vs off-chain split: *money, state, and proof hashes live on-chain; bulky or
private content (title, description, submission text) lives off-chain.*

## 2. Smart Contract Design (`contracts/contracts/BountyVault.sol`)

Solidity `^0.8.24`, Hardhat toolchain, MIT license. ETH only (no ERC-20 in MVP).

### 2.1 State machine

```
                 submitWork (first valid submission,
              ┌────────────── before/at deadline)
              ▼
  ┌───────┐            ┌───────────┐  approveSubmission   ┌──────┐
  │ Open  │───────────►│ Submitted │─────────────────────►│ Paid │
  └───┬───┘            └───────────┘                      └──────┘
      │ cancelBounty (poster, no submission yet;
      │ before OR after deadline)
      ▼
┌───────────┐
│ Cancelled │
└───────────┘
```

`Paid` and `Cancelled` are terminal. No other transitions exist.

### 2.2 Types & storage

```solidity
enum BountyStatus { Open, Submitted, Paid, Cancelled }   // 0,1,2,3

struct Bounty {
    address poster;          // bounty creator, receives refunds
    address hunter;          // set by the first valid submitWork; address(0) while Open
    uint256 amount;          // escrowed wei (== msg.value at creation)
    uint64  deadline;        // unix timestamp, seconds
    BountyStatus status;
    bytes32 submissionHash;  // keccak256(utf8(submission text)); 0x0 while Open
}

uint256 public bountyCount;                       // also the next bounty id
mapping(uint256 => Bounty) public bounties;       // id => Bounty, ids start at 0
```

### 2.3 Events

```solidity
event BountyCreated(
    uint256 indexed bountyId,
    address indexed poster,
    uint256 amount,
    uint64 deadline
);

event WorkSubmitted(
    uint256 indexed bountyId,
    address indexed hunter,
    bytes32 submissionHash
);

event BountyPaid(
    uint256 indexed bountyId,
    address indexed hunter,
    uint256 amount
);

event BountyCancelled(
    uint256 indexed bountyId,
    uint256 refundAmount
);
```

The backend indexer reconstructs all list views from these events; the frontend may
parse `BountyCreated` from the transaction receipt to learn the new `bountyId`.

### 2.4 Functions

```solidity
/// Create a bounty and lock `msg.value` in escrow.
/// Reverts: ZeroAmount, InvalidDeadline (deadline must be > block.timestamp).
function createBounty(uint64 deadline) external payable returns (uint256 bountyId);

/// First submission wins (MVP): records hunter + hash, Open -> Submitted.
/// Reverts: BountyNotFound, WrongStatus (not Open), DeadlinePassed
///          (block.timestamp > deadline), PosterCannotSubmit, EmptySubmissionHash.
function submitWork(uint256 bountyId, bytes32 submissionHash) external;

/// Poster accepts the submission; full escrow to hunter. Submitted -> Paid.
/// Callable after the deadline (deadline gates submission, not settlement).
/// Reverts: BountyNotFound, WrongStatus (not Submitted), NotPoster, TransferFailed.
function approveSubmission(uint256 bountyId) external;

/// Poster cancels an Open bounty; full refund to poster. Open -> Cancelled.
/// Allowed before AND after the deadline, as long as no submission exists.
/// Reverts: BountyNotFound, WrongStatus (not Open), NotPoster, TransferFailed.
function cancelBounty(uint256 bountyId) external;

/// Convenience getter (the public mapping also works; this returns the struct).
function getBounty(uint256 bountyId) external view returns (Bounty memory);
```

### 2.5 Custom errors

```solidity
error ZeroAmount();
error InvalidDeadline();
error BountyNotFound(uint256 bountyId);
error WrongStatus(BountyStatus expected, BountyStatus actual);
error NotPoster(address caller);
error PosterCannotSubmit();
error DeadlinePassed(uint64 deadline, uint64 now_);
error EmptySubmissionHash();
error TransferFailed(address to, uint256 amount);
```

### 2.6 Deadline & refund boundary rules (normative)

| # | Rule |
|---|------|
| R1 | `createBounty` requires `msg.value > 0` and `deadline > block.timestamp` (strictly future). |
| R2 | `submitWork` is accepted while `block.timestamp <= deadline` — a tx mined exactly at the deadline timestamp is **valid** (inclusive boundary). |
| R3 | Exactly one submission per bounty: the first valid `submitWork` moves Open → Submitted; all later calls revert `WrongStatus`. |
| R4 | The deadline never gates `approveSubmission`: a submission made in time can be approved at any later time. |
| R5 | `cancelBounty` requires status **Open** (no submission). Allowed both before and after the deadline — a bounty nobody took must not lock funds forever. |
| R6 | In status **Submitted**, funds can only move via `approveSubmission`. If the poster never acts, the escrow stays locked (documented MVP limitation; stretch: arbitration). |
| R7 | Payouts use Checks-Effects-Interactions: update state → emit event → `call{value: amount}("")`; revert `TransferFailed` on failure. `approveSubmission` and `cancelBounty` are additionally `nonReentrant` (OpenZeppelin `ReentrancyGuard`). |
| R8 | No protocol fee in MVP: payout/refund equals the full escrowed amount; gas is paid by the transacting party. |

### 2.7 Hash convention (shared by frontend & backend — normative)

```
submissionHash = keccak256( utf8Bytes( content ) )
```

- Frontend: `ethers.keccak256(ethers.toUtf8Bytes(content))` (Ethers.js v6).
- Backend: identical call on the exact submitted string — **no trimming, no
  normalization**; the raw request body string is hashed.
- Off-chain content is accepted by the backend only if its recomputed hash equals the
  on-chain `submissionHash`.

## 3. Backend (`backend/` — Node.js + Express + SQLite)

Two responsibilities: (a) store off-chain content, (b) index contract events into
SQLite so reads never hit the RPC node on the hot path. Chain stays source of truth;
SQLite is a rebuildable cache plus content store.

### 3.1 Data model (SQLite, `better-sqlite3`)

```sql
-- Off-chain metadata for an on-chain bounty (one row per bounty).
CREATE TABLE bounties (
  on_chain_id     INTEGER PRIMARY KEY,   -- bountyId in the contract
  poster_address  TEXT NOT NULL,         -- 0x-prefixed, lowercase
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  create_tx_hash  TEXT NOT NULL UNIQUE,  -- tx that emitted BountyCreated
  created_at      TEXT NOT NULL,         -- ISO 8601 UTC
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'orphaned'))
);

-- Full submission text; hash must match the on-chain submissionHash.
CREATE TABLE submissions (
  on_chain_id     INTEGER PRIMARY KEY,   -- one submission per bounty (MVP)
  hunter_address  TEXT NOT NULL,
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,         -- 0x-prefixed keccak256, 66 chars
  submit_tx_hash  TEXT NOT NULL UNIQUE,
  submitted_at    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'orphaned'))
);

-- Rebuildable index of contract events (drives list/status views).
CREATE TABLE chain_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name      TEXT NOT NULL,         -- BountyCreated|WorkSubmitted|BountyPaid|BountyCancelled
  on_chain_id     INTEGER NOT NULL,
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL,
  block_number    INTEGER NOT NULL,
  payload         TEXT NOT NULL,         -- JSON of decoded event args
  processed_at    TEXT NOT NULL,
  UNIQUE (tx_hash, log_index)            -- idempotent re-indexing
);

-- Indexer checkpoint (last fully processed block).
CREATE TABLE indexer_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_block      INTEGER NOT NULL
);
```

Addresses are stored lowercase; compare case-insensitively.

The `status` column on `bounties` and `submissions` persists the asynchronous
verification lifecycle of §3.2 Notes: the API inserts rows as `pending`, and the
indexer (§3.3) reconciles them against indexed on-chain events — `confirmed`
when the referenced transaction (and, for submissions, the hunter and content
hash) matches, `orphaned` when the chain contradicts it. `orphaned` rows are
hidden from all API reads.

### 3.2 REST API (base `/api`, JSON)

| Method & path | Body / query | Success | Errors |
|---|---|---|---|
| `GET /health` | — | `200 { "status": "ok" }` | — |
| `POST /bounties` | `{ onChainId, posterAddress, title, description, createTxHash }` | `201` created row | `400` validation, `409` metadata exists |
| `GET /bounties?status=&poster=&hunter=` | filters optional; `status` ∈ `open,submitted,paid,cancelled` | `200` array of joined records (metadata + latest indexed chain state) | `400` bad filter |
| `GET /bounties/:onChainId` | — | `200` single record incl. submission summary (`hunterAddress`, `contentHash`, `submittedAt`), **without** full content | `404` |
| `POST /bounties/:onChainId/submissions` | `{ hunterAddress, content, submitTxHash }` | `201` stored row | `409` already submitted, `422` hash mismatch with on-chain event |
| `GET /bounties/:onChainId/submission?address=0x…` | `address` = requester | `200 { content, contentHash, hunterAddress, submittedAt }` | `403` unless address == poster or hunter, `404` |

Notes:

- `POST /bounties` and `POST …/submissions` are **verified asynchronously**: the
  indexer confirms the referenced tx emitted the matching event; unconfirmed rows are
  flagged `pending` in list responses until confirmed. (MVP simplification: accept
  first, reconcile; rejected rows are marked `orphaned` and hidden.)
- MVP access control on `GET …/submission` is a plain address check (documented in
  the PRD). Stretch: EIP-191 signed-challenge authentication.
- No writes to the blockchain ever happen server-side; the backend has no keys.

### 3.3 Event indexer

- Polls `eth_getLogs` for the contract address from `indexer_state.last_block + 1`
  to the latest finalized block every ~15 s (configurable), decodes with the contract
  ABI, upserts into `chain_events` (idempotent via `UNIQUE(tx_hash, log_index)`).
- Reorg policy (MVP): only index blocks at least 12 confirmations deep.
- On boot, if `chain_events` is empty, index from the deployment block (stored in
  `backend/.env` as `DEPLOYMENT_BLOCK`).

## 4. Frontend (`frontend/` — React + Vite + Ethers.js v6)

### 4.1 Pages & routes (React Router)

| Route | Page | Purpose | On-chain writes |
|---|---|---|---|
| `/` | `BountyListPage` | All bounties with status filter (`open` default) | — |
| `/bounties/new` | `CreateBountyPage` | Title, description, reward (ETH), deadline picker | `createBounty` (payable) |
| `/bounties/:id` | `BountyDetailPage` | Status timeline, metadata, actions by role: hunter sees `SubmitWorkForm` (Open + before deadline); poster sees submission text + `Approve` (Submitted) or `Cancel` (Open) | `submitWork`, `approveSubmission`, `cancelBounty` |
| `/my` | `MyDashboardPage` | "My bounties" (as poster) and "My submissions" (as hunter) for the connected account | — |

### 4.2 Key modules & components

- `src/lib/contract.js` — single contract abstraction: address + ABI import,
  `getReadContract(provider)` / `getWriteContract(signer)`. All components call this;
  no inline ABI copies.
- `src/lib/wallet.js` — `BrowserProvider` setup, `connect()`, account/chain
  subscription (`accountsChanged`, `chainChanged`), Sepolia enforcement
  (chainId `11155111` / `0xaa36a7`; prompt `wallet_switchEthereumChain` otherwise).
- Components: `WalletButton`, `BountyCard`, `StatusBadge`, `SubmitWorkForm`,
  `ApproveButton`, `CancelButton`, `DeadlineCountdown`.
- After each confirmed tx, the affected queries refetch (backend API) and the
  receipt's events are parsed for immediate UI feedback (e.g., new `bountyId`).

### 4.3 Config

`frontend/.env` (template committed as `.env.example`):
`VITE_CONTRACT_ADDRESS`, `VITE_CHAIN_ID=11155111`, `VITE_BACKEND_URL=http://localhost:3001`.

## 5. Repository Layout

```
bounty-vault/
├── contracts/                    # Hardhat project
│   ├── contracts/BountyVault.sol
│   ├── test/BountyVault.test.js  # state machine + R1–R8 boundary tests
│   ├── scripts/deploy.js         # Sepolia deploy, prints address + block
│   ├── hardhat.config.js
│   └── .env.example              # SEPOLIA_RPC_URL, PRIVATE_KEY (never committed)
├── backend/
│   ├── src/index.js              # Express bootstrap
│   ├── src/routes/bounties.js
│   ├── src/routes/submissions.js
│   ├── src/db.js                 # better-sqlite3 schema + migrations
│   ├── src/indexer.js            # event indexer loop
│   └── .env.example              # PORT, RPC, CONTRACT_ADDRESS, DEPLOYMENT_BLOCK
├── frontend/
│   ├── src/pages/                # routes from §4.1
│   ├── src/components/
│   ├── src/lib/{contract.js,wallet.js}
│   └── .env.example
├── docs/
│   ├── PRD.md
│   └── ARCHITECTURE.md           # this file
└── README.md                     # setup + run + demo script
```

Env hygiene: real `.env` files are git-ignored everywhere; only `.env.example`
templates are committed.

## 6. Eight-Week Milestone Plan (2026-09-15 → 2026-11-08 23:59)

| Week | Dates | Deliverables |
|---|---|---|
| 1 | Sep 15 – Sep 21 | ✅ PRD + architecture (this document); repo scaffolding: Hardhat, Vite/React, Express skeletons; root README outline |
| 2 | Sep 22 – Sep 28 | `BountyVault.sol` implemented; Hardhat unit tests covering the state machine and every boundary rule R1–R8; local Hardhat-node deployment |
| 3 | Sep 29 – Oct 5 | Contract deployed to Sepolia (address + deployment block recorded); backend: SQLite schema + `POST/GET /bounties` APIs |
| 4 | Oct 6 – Oct 12 | Backend: submissions API with hash verification; event indexer live against Sepolia; API integration tests |
| 5 | Oct 13 – Oct 19 | Frontend: wallet connect + network guard; bounty list and create-bounty flow working end-to-end on Sepolia |
| 6 | Oct 20 – Oct 26 | Frontend: submit / approve / cancel flows on the detail page; all four PRD flows (F1–F4) walkable with two MetaMask accounts |
| 7 | Oct 27 – Nov 2 | Hardening: edge-case retest, error/UX polish, README completed (setup, faucets, deploy, demo script); decide on stretch items only if green |
| 8 | Nov 3 – Nov 8 | Project report PDF (background/idea/design/implementation/contribution); slides; record ≤ 15-min English demo video; final buffer — **submit by Nov 8, 23:59** |

Suggested role split (4–5 members): contract lead, backend lead, frontend lead,
frontend/QA + report/video. Exact assignment is a team decision and is recorded in
the report's contribution section.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sepolia faucet friction for 4–5 testers | Week 3 deployment includes a shared faucet runbook in the README; keep bounty amounts tiny (0.001–0.01 ETH) |
| Indexer lag confuses the demo | UI parses tx receipts for immediate feedback; indexer only backfills lists |
| Scope creep (stretch items) | Stretch list is frozen in the PRD; pull one in only after Week 6 demo flows pass |
| Funds locked by an idle poster (R6) | Documented limitation; arbitration is stretch #1 |
