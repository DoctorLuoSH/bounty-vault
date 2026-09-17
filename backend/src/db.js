'use strict';

const Database = require('better-sqlite3');

/**
 * SQLite schema per docs/ARCHITECTURE.md section 3.1. The `status` columns on
 * `bounties` and `submissions` implement the pending/confirmed/orphaned
 * lifecycle described in section 3.2: rows are accepted optimistically and
 * reconciled against indexed on-chain events by the indexer. SQLite is a
 * rebuildable index cache plus content store; the chain stays the source of
 * truth. Addresses and hashes are stored lowercase.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS bounties (
  on_chain_id     INTEGER PRIMARY KEY,   -- bountyId in the contract
  poster_address  TEXT NOT NULL,         -- 0x-prefixed, lowercase
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  create_tx_hash  TEXT NOT NULL UNIQUE,  -- tx that emitted BountyCreated
  created_at      TEXT NOT NULL,         -- ISO 8601 UTC
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'orphaned'))
);

CREATE TABLE IF NOT EXISTS submissions (
  on_chain_id     INTEGER PRIMARY KEY,   -- one submission per bounty (MVP)
  hunter_address  TEXT NOT NULL,         -- 0x-prefixed, lowercase
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,         -- 0x-prefixed keccak256, 66 chars
  submit_tx_hash  TEXT NOT NULL UNIQUE,
  submitted_at    TEXT NOT NULL,         -- ISO 8601 UTC
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'orphaned'))
);

CREATE TABLE IF NOT EXISTS chain_events (
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

CREATE INDEX IF NOT EXISTS idx_chain_events_on_chain_id
  ON chain_events (on_chain_id);

CREATE TABLE IF NOT EXISTS indexer_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  last_block      INTEGER NOT NULL
);
`;

/**
 * Open (and if needed initialize) the database at `dbPath`. Pass ':memory:'
 * for an ephemeral database (tests).
 */
function createDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

/** Latest decoded event of a given name for a bounty, or null. */
function getLatestEvent(db, eventName, onChainId) {
  const row = db
    .prepare(
      `SELECT tx_hash, block_number, payload
         FROM chain_events
        WHERE event_name = ? AND on_chain_id = ?
        ORDER BY block_number DESC, log_index DESC
        LIMIT 1`
    )
    .get(eventName, onChainId);
  if (!row) return null;
  return {
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    payload: JSON.parse(row.payload),
  };
}

/**
 * Fold all indexed chain_events into the latest on-chain state per bounty id.
 * Pass `onChainId` to fold a single bounty. Returns Map(onChainId => state)
 * where state is { status, poster, amount, deadline, hunterAddress,
 * submissionHash } with status in open|submitted|paid|cancelled.
 */
function getChainStates(db, onChainId) {
  const rows =
    onChainId === undefined
      ? db
          .prepare(
            `SELECT event_name, on_chain_id, payload
               FROM chain_events
              ORDER BY block_number ASC, log_index ASC`
          )
          .all()
      : db
          .prepare(
            `SELECT event_name, on_chain_id, payload
               FROM chain_events
              WHERE on_chain_id = ?
              ORDER BY block_number ASC, log_index ASC`
          )
          .all(onChainId);
  const states = new Map();
  for (const row of rows) {
    const next = applyEvent(states.get(row.on_chain_id), row.event_name, JSON.parse(row.payload));
    if (next) states.set(row.on_chain_id, next);
  }
  return states;
}

function applyEvent(prev, eventName, payload) {
  switch (eventName) {
    case 'BountyCreated':
      return {
        status: 'open',
        poster: payload.poster,
        amount: payload.amount,
        deadline: payload.deadline,
        hunterAddress: null,
        submissionHash: null,
      };
    case 'WorkSubmitted':
      if (!prev) return null;
      return {
        ...prev,
        status: 'submitted',
        hunterAddress: payload.hunter,
        submissionHash: payload.submissionHash,
      };
    case 'BountyPaid':
      if (!prev) return null;
      return { ...prev, status: 'paid', hunterAddress: payload.hunter };
    case 'BountyCancelled':
      if (!prev) return null;
      return { ...prev, status: 'cancelled' };
    default:
      return prev || null;
  }
}

module.exports = { createDatabase, getLatestEvent, getChainStates };
