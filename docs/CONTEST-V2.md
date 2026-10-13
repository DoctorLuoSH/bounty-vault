# BountyVault V2 — Contest Bounties: Design Document

**Status:** implemented in `contracts/contracts/BountyVaultV2.sol` (tests:
`contracts/test/BountyVaultV2.test.js`). **Decision date:** 2026-10-13.
**Scope of this document:** contract design only. Frontend/backend adaptation
and redeployment are follow-up issues.

**Companion documents:** `docs/ARCHITECTURE.md` §2 documents v1
(`contracts/contracts/BountyVault.sol`), which stays deployed and unchanged.
V2 is a separate contract — not a proxy upgrade.

## 1. Motivation

V1 is single-hunter, first-submission-wins: the first `submitWork` locks the
bounty and the poster can only approve or wait. The 2026-10-13 product decision
upgrades BountyVault to a **contest model**:

- **Multiple hunters submit** competing work for the same bounty.
- **Manual judging:** the poster reviews all submissions and picks one winner.
- **Optimistic settlement:** if the poster never judges, the bounty settles
  automatically to the first submission once a fixed review window has passed —
  an idle poster can no longer lock everyone's money (v1 limitation R6).

## 2. Lifecycle (happy path)

1. **Publish.** The poster calls `createBounty(deadline, metadataHash)`, locking
   the full reward in escrow. `metadataHash = keccak256(utf8(bounty
   description))`; the full text lives in the off-chain backend. This is the
   *requirement commitment*: the poster cannot quietly rewrite the brief later.
2. **Submit.** Any hunter (≠ poster) calls `submitWork(bountyId,
   submissionHash)` while `block.timestamp <= deadline` (inclusive boundary,
   same rule as v1 R2). Every submission is recorded. Each address keeps **one
   live submission**: re-submitting **overwrites** the sender's previous entry
   in place (same array index, refreshed hash and timestamp) — revising work is
   allowed, array spam by one address is not.
3. **Review window.** After the deadline, a `REVIEW_PERIOD = 7 days` window
   begins (contract constant). The poster reads submissions off-chain.
4. **Manual judging.** Within the window — including *before* the deadline, so
   the poster may **close the contest early** once ≥ 1 submission exists — the
   poster calls `selectWinner(bountyId, index)`. That hunter earns the whole
   escrow (winner-take-all); the bounty is `Paid`.
5. **Optimistic settlement.** If the poster does nothing within the window,
   **anyone** may call `settleExpired(bountyId)` afterwards; the **first**
   submission wins.
6. **Withdrawal.** All v2 payouts are **pull-based**: `selectWinner` /
   `settleExpired` / `cancelBounty` only credit `pendingWithdrawals[payee]`;
   the payee collects via `withdraw()`.
7. **No-show.** With **zero** submissions (before or after the deadline) the
   poster may `cancelBounty` for a full refund. Same rule as v1 R5: **once any
   submission exists, the bounty can never be cancelled.**

## 3. State machine

Only three states are stored: `Open → Paid` and `Open → Cancelled`, both
terminal. The "review window" is a *logical* state derived from
`block.timestamp` versus `deadline + REVIEW_PERIOD` — it is never persisted,
which saves gas and can never disagree with wall-clock time.

| Stored state | Time condition | Allowed calls |
|---|---|---|
| `Open` | `t ≤ deadline` | `submitWork`; `selectWinner` (early close, needs ≥ 1 submission); `cancelBounty` (zero submissions only) |
| `Open` | `deadline < t ≤ deadline + REVIEW_PERIOD` | `selectWinner` only (or zero-submission `cancelBounty`) |
| `Open` | `t > deadline + REVIEW_PERIOD` | `settleExpired` (needs ≥ 1 submission); zero-submission `cancelBounty` still allowed |
| `Paid` / `Cancelled` | — | terminal; everything reverts `WrongStatus` |

## 4. Contract interface

```solidity
enum BountyStatus { Open, Paid, Cancelled }

struct Submission { address hunter; bytes32 submissionHash; uint64 submittedAt; }

struct Bounty {
    address poster;
    uint256 amount;
    uint64  deadline;
    BountyStatus status;
    bytes32 metadataHash;
}

uint64 public constant REVIEW_PERIOD = 7 days;

uint256 public bountyCount;                                     // also next id
mapping(uint256 => Bounty) public bounties;
mapping(uint256 => Submission[]) internal _submissions;         // never iterated on-chain
mapping(uint256 => mapping(address => uint256)) public submissionIndexOf; // 1-based; 0 = none
mapping(address => uint256) public pendingWithdrawals;
```

Functions (ids start at 0; all unknown ids revert `BountyNotFound`):

| Function | Guards | Effect |
|---|---|---|
| `createBounty(uint64 deadline, bytes32 metadataHash) payable → uint256` | `msg.value > 0`; `deadline > block.timestamp` | Stores bounty, locks escrow, emits `BountyCreated`. `metadataHash` **may be 0** (pure on-chain usage without a backend). |
| `submitWork(uint256 id, bytes32 hash)` | `Open`; `t ≤ deadline` (inclusive); `≠ poster`; `hash ≠ 0` | Appends a new submission, or overwrites the sender's existing one in place. Emits `WorkSubmitted(id, index, hunter, hash)`. |
| `selectWinner(uint256 id, uint256 index)` | `Open`; caller = poster; `t ≤ deadline + REVIEW_PERIOD`; `index < count` | `Paid`; credits full escrow to `submissions[index].hunter`. No external calls. Emits `WinnerSelected`. |
| `settleExpired(uint256 id)` | `Open`; `t > deadline + REVIEW_PERIOD`; ≥ 1 submission | `Paid`; credits full escrow to `submissions[0].hunter`. Callable by anyone. Emits `BountySettledExpired`. |
| `cancelBounty(uint256 id)` | `Open`; caller = poster; **zero submissions** | `Cancelled`; credits full refund to the poster (pull). Emits `BountyCancelled`. |
| `withdraw()` | ledger balance > 0 | Pull payout of everything owed to the caller; `nonReentrant`, CEI (zero → emit → transfer). |
| `getSubmissionCount(id)` / `getSubmission(id, index)` / `getBounty(id)` | views | Off-chain paging over the submission list; `getSubmission` reverts `InvalidSubmissionIndex` out of range. |

Events:

```solidity
event BountyCreated(uint256 indexed bountyId, address indexed poster,
                    uint256 amount, uint64 deadline, bytes32 metadataHash);
event WorkSubmitted(uint256 indexed bountyId, uint256 index,
                    address indexed hunter, bytes32 submissionHash);
event WinnerSelected(uint256 indexed bountyId, uint256 index,
                     address indexed hunter, uint256 amount);
event BountySettledExpired(uint256 indexed bountyId,
                           address indexed hunter, uint256 amount);
event BountyCancelled(uint256 indexed bountyId, uint256 refundAmount);
event Withdrawn(address indexed account, uint256 amount);
```

An overwrite re-emits `WorkSubmitted` with the **same index**, so an off-chain
indexer can upsert by `(bountyId, index)`.

Custom errors: `ZeroAmount`, `InvalidDeadline`, `BountyNotFound`, `WrongStatus`,
`NotPoster`, `PosterCannotSubmit`, `DeadlinePassed`, `EmptySubmissionHash`,
`NoSubmissions`, `HasSubmissions`, `InvalidSubmissionIndex`, `ReviewPeriodEnded`,
`ReviewPeriodActive`, `NothingToWithdraw`, `TransferFailed`.

## 5. Threat model

| # | Attack / failure mode | Mitigation or accepted trade-off |
|---|---|---|
| 1 | Poster reads every proposal then goes silent, harvesting ideas for free | **Optimistic settlement**: after the window, `settleExpired` pays the first submission. Trade-off: on-chain code cannot judge quality, so the deterministic fallback rewards *earliest*, not *best* — documented, not hidden. |
| 2 | Poster awards a sock-puppet (collusion), real hunters work for nothing | Collusion is unrecognizable on-chain; this is an **inherent, accepted flaw** of the poster-as-judge model. Funds can at least never flow to an address that never submitted. v3 directions: judging committee / dispute period / platform reputation. |
| 3 | Spam / Sybil submissions | One live submission per address (re-submit overwrites); every submission costs gas; filtering happens off-chain by the poster; the array is never iterated on-chain. Residual risk: the first-submission fallback could be gamed by a spammer — but it only triggers when the poster idles, so this is accepted. |
| 4 | Poster wants "reject all and refund" (`rejectAll`) | **Deliberately not provided.** Offering it lets a poster exit at zero cost after seeing all the work — a free idea-harvesting channel. The only refund path is: zero submissions. |
| 5 | Poster rewrites the brief afterwards (moving goalposts) | `metadataHash` commits the brief on-chain at creation; the backend stores the full text; in a dispute, presenting the original text and recomputing the hash proves tampering. |
| 6 | Payee is a contract that rejects ETH → push transfer reverts forever → **funds locked permanently** (latent v1 defect: single-hunter approve could never succeed) | v2 is **fully pull-based** (`pendingWithdrawals` + `withdraw()`). Settlement transactions contain no external calls, so a rejecting payee can never block a bounty from reaching its terminal state; only its own withdrawal fails, by its own choice, and its credit survives the failed transfer. |
| 7 | Reentrancy | OpenZeppelin `ReentrancyGuard` on `withdraw`; Checks-Effects-Interactions everywhere; the ledger is zeroed before the transfer. |
| 8 | Transaction races at the deadline / window boundary | Deadline is inclusive (v1 R2). A `selectWinner` / `settleExpired` race resolves first-come-first-served; both pay a legitimate submitter, so no funds are at risk either way. |
| 9 | Unbounded growth of the submissions array | On-chain access is strictly by index (`selectWinner` by `index`, `settleExpired` reads `[0]`); list display is an off-chain concern (event indexing + pagination). |
| 10 | Miner timestamp manipulation | Second-level drift is irrelevant against day-scale windows; accepted risk. |
| 11 | Poster closes early and later hunters prepared for nothing | Kept as a **feature** (standard practice in real contests). UI/docs must state clearly: "the poster may pick a winner at any time before the deadline." |
| 12 | v1 → v2 migration | No proxy. v2 deploys as a new contract; v1 history stays queryable at the old address; the README records both addresses after redeployment (follow-up issue, not this one). |

## 6. Parameter decisions

- **`REVIEW_PERIOD = 7 days`, contract constant** — not a per-bounty parameter.
  Letting posters set it would let an over-long window hollow out the hunters'
  optimistic-settlement fallback, and bounding it would add validation
  complexity that is not worth it.
- **Winner-take-all** — the whole escrow goes to one winner. Splitting the pool
  across ranked placements is recorded as a future option, not implemented.
- **No platform fee** (carried over from v1 R8): payout and refund equal the
  full escrow; gas is paid by the transacting party.
- **`metadataHash` may be 0** — a purely on-chain deployment with no backend can
  still create bounties, simply giving up the requirement commitment.
- **Pull payments for everything, including cancel refunds** — one uniform
  money-out path (`withdraw`) instead of two semantics; settlement and cancel
  can never revert on a transfer.

## 7. Out of scope (follow-up issues)

- Frontend adaptation: submission list, winner picking, withdraw button,
  countdowns.
- Backend event indexing and metadata API for the v2 events.
- Sepolia redeployment and demo data (README address records per threat #12).
- Platform fees, prize-pool splitting, committee / dispute mechanisms (v3).
