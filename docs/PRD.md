# BountyVault — Product Requirements Document

**Course:** COMP7610 Introduction to Web3 and Blockchain — Final Project
**Team submission deadline:** 2026-11-08 23:59
**Status:** v1.0 (MVP scope)

## 1. Product Story & Value Proposition

Freelance task platforms today run on a single trust assumption: the platform holds
the money, so the platform must be honest, solvent, and responsive. Posters worry
their funds will be frozen or skimmed; hunters worry they will deliver work and never
get paid. Both sides pay high fees for that central escrow.

**BountyVault replaces platform trust with smart-contract trust.** A poster creates a
task bounty and locks the reward in an escrow contract on Ethereum. A hunter submits
work; the submission's hash is anchored on-chain (tamper-proof proof of *what* was
submitted and *when*), while the full content is stored off-chain. When the poster
accepts the work, the contract releases the funds directly to the hunter. If no one
takes the task, the poster cancels and the contract refunds the escrow. No platform
can freeze, redirect, or delay the money — the rules are code, deployed once and
visible to everyone.

## 2. Goals & Non-Goals

**Goals (MVP)**

- Demonstrate a complete, working DApp on the Sepolia testnet that a grader can run
  and drive end-to-end with MetaMask.
- Cover the full bounty lifecycle in four on-chain flows (see §4).
- Keep every component simple, well-documented, and reproducible from the README.

**Non-Goals (MVP)**

- No ERC-20 token rewards — native (test) ETH only.
- No dispute arbitration between poster and hunter (stretch).
- No multiple/competing submissions per bounty (stretch).
- No user accounts or passwords; the wallet address *is* the identity.

## 3. Roles

| Role | Description | Key actions |
|------|-------------|-------------|
| **Poster** | Creates a bounty and funds it. | Create bounty + lock escrow; review submission; approve (release payment) or cancel (reclaim escrow). |
| **Hunter** | Completes a bounty and submits the result. | Browse open bounties; submit work (hash on-chain, full text off-chain); receive payment on approval. |

One wallet can act as poster on one bounty and hunter on another; a poster may **not**
submit work to their own bounty (enforced by the contract).

## 4. MVP Core Flows

### F1 — Create bounty & fund escrow

1. Poster connects MetaMask (Sepolia).
2. Poster fills in title, description, reward amount, and deadline.
3. Frontend calls `createBounty` with the reward as `msg.value`; the contract locks
   the ETH in escrow and emits `BountyCreated`.
4. Frontend stores the off-chain metadata (title, description) in the backend, keyed
   by the on-chain bounty ID parsed from the transaction receipt.
5. The bounty appears in the public list as **Open**.

### F2 — Submit work (hash on-chain, full text off-chain)

1. Hunter opens an **Open** bounty before its deadline.
2. Hunter writes the deliverable text and submits.
3. Frontend computes `keccak256(utf8(content))` and calls `submitWork` with the hash;
   the contract records hunter + hash and moves the bounty to **Submitted**.
4. Frontend sends the full content to the backend, which re-computes the hash and
   stores the content only if it matches the on-chain hash.
5. MVP accepts exactly **one** submission per bounty — the first valid one.

### F3 — Approve & release payment

1. Poster reviews the submission (full text fetched from the backend, hash verifiable
   against the chain).
2. Poster calls `approveSubmission`; the contract transfers the full escrow to the
   hunter and moves the bounty to **Paid**.
3. Approval is allowed after the deadline — the deadline gates *submission*, not
   *settlement*.

### F4 — Cancel & refund before conclusion

1. While a bounty is still **Open** (no submission yet), the poster may call
   `cancelBounty`.
2. The contract refunds the full escrow to the poster and moves the bounty to
   **Cancelled**.
3. Cancellation is also allowed after the deadline if the bounty never received a
   submission — this prevents funds from being locked forever. Once a submission
   exists, cancellation is impossible (see known limitation in §7).

## 5. MVP Scope vs. Stretch

**MVP (committed)**

- F1–F4 above, on Sepolia, with React + Ethers.js frontend, Node/Express/SQLite
  backend (metadata + event indexer), and a single Solidity escrow contract.

**Stretch (only if ahead of schedule, in priority order)**

1. **Dispute arbitration** — a third arbiter address that can resolve a stale
   `Submitted` bounty (release to hunter or refund poster).
2. **Multiple competing submissions** — many hunters submit; poster picks a winner.
3. **Hunter NFT credential** — mint a non-transferable NFT (soulbound-style) to the
   hunter on each successful `Paid` bounty as a portable proof of completion.
4. **Reputation score** — backend-computed score from indexed on-chain history
   (completed bounties, total earned), displayed next to addresses.

## 6. Course Rubric Self-Check

| Requirement | How BountyVault meets it | Where |
|---|---|---|
| Frontend interface (React/Vue/Vanilla) | React (Vite) single-page app | `frontend/` |
| Smart contract backend | Solidity escrow contract with the full bounty state machine | `contracts/` |
| Blockchain library bridge | Ethers.js v6 (`BrowserProvider`, `Contract`) between React and the contract | `frontend/src/lib/` |
| Crypto wallet | MetaMask connection, account display, network check (Sepolia chainId `0xaa36a7`) | frontend header |
| ≥ 1 meaningful on-chain operation | Four state-changing operations: `createBounty` (payable), `submitWork`, `approveSubmission`, `cancelBounty` | contract |
| Testnet | Sepolia; deploy script + `.env` template; README faucets section | `contracts/` |
| Complete runnable source + detailed README | Root README with setup, deploy, and run instructions | repo root |
| Project report (PDF) | background / idea / design / implementation / contribution distribution | delivered at final submission |
| Demo video ≤ 15 min, English | Story + core functions + live demo | delivered at final submission |

## 7. Known MVP Limitations (accepted, documented)

- If a poster never approves a valid submission, the escrow stays locked; resolution
  requires the stretch arbitration mechanism.
- Submission full text is private to poster and hunter via a backend address check —
  MVP-grade access control, not cryptographic auth.
- One submission per bounty means a weak first submission blocks competitors;
  competing submissions are a stretch item.

## 8. Success Criteria for the Demo

- A grader with MetaMask on Sepolia can execute F1–F4 in under 10 minutes using two
  accounts (poster, hunter).
- Every on-chain transition is visible on a Sepolia block explorer and reflected in
  the UI without manual refresh hacks (backend indexer or event-driven refetch).
