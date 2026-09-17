'use strict';

const { Interface } = require('ethers');

const { getLatestEvent } = require('./db');

/**
 * Event ABI of BountyVault.sol (docs/ARCHITECTURE.md section 2.3). The backend
 * only ever reads logs — it has no keys and never sends transactions.
 */
const EVENT_ABI = [
  'event BountyCreated(uint256 indexed bountyId, address indexed poster, uint256 amount, uint64 deadline)',
  'event WorkSubmitted(uint256 indexed bountyId, address indexed hunter, bytes32 submissionHash)',
  'event BountyPaid(uint256 indexed bountyId, address indexed hunter, uint256 amount)',
  'event BountyCancelled(uint256 indexed bountyId, uint256 refundAmount)',
];

const iface = new Interface(EVENT_ABI);

function decodeLog(log) {
  const parsed = iface.parseLog({ topics: log.topics, data: log.data });
  if (!parsed) return null;
  const a = parsed.args;
  switch (parsed.name) {
    case 'BountyCreated':
      return {
        eventName: 'BountyCreated',
        onChainId: Number(a.bountyId),
        payload: {
          poster: a.poster.toLowerCase(),
          amount: a.amount.toString(),
          deadline: Number(a.deadline),
        },
      };
    case 'WorkSubmitted':
      return {
        eventName: 'WorkSubmitted',
        onChainId: Number(a.bountyId),
        payload: {
          hunter: a.hunter.toLowerCase(),
          submissionHash: a.submissionHash.toLowerCase(),
        },
      };
    case 'BountyPaid':
      return {
        eventName: 'BountyPaid',
        onChainId: Number(a.bountyId),
        payload: { hunter: a.hunter.toLowerCase(), amount: a.amount.toString() },
      };
    case 'BountyCancelled':
      return {
        eventName: 'BountyCancelled',
        onChainId: Number(a.bountyId),
        payload: { refundAmount: a.refundAmount.toString() },
      };
    default:
      return null;
  }
}

/**
 * Polling event indexer (docs/ARCHITECTURE.md section 3.3).
 *
 * - Indexes eth_getLogs from indexer_state.last_block + 1 up to
 *   latest - confirmations (reorg policy: 12 confirmations by default).
 * - Idempotent via UNIQUE(tx_hash, log_index) + INSERT OR IGNORE; the
 *   checkpoint advances inside the same transaction as the inserts.
 * - After each pass, pending metadata/submission rows are reconciled against
 *   the indexed events (confirmed on match, orphaned on contradiction).
 *
 * `provider` only needs getBlockNumber() and getLogs() (an ethers
 * JsonRpcProvider in production, a stub in tests).
 */
function createIndexer({
  db,
  provider,
  contractAddress,
  deploymentBlock = 0,
  confirmations = 12,
  pollIntervalMs = 15000,
  chunkSize = 2000,
  logger = console,
}) {
  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO chain_events
       (event_name, on_chain_id, tx_hash, log_index, block_number, payload, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const upsertState = db.prepare(
    `INSERT INTO indexer_state (id, last_block) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET last_block = excluded.last_block`
  );

  /** One polling pass; returns { from, to, indexed }. */
  async function indexOnce() {
    const latest = await provider.getBlockNumber();
    const safeTo = latest - confirmations;
    const row = db.prepare('SELECT last_block FROM indexer_state WHERE id = 1').get();
    const from = row ? row.last_block + 1 : Math.max(0, deploymentBlock);
    if (from > safeTo) {
      return { from, to: from - 1, indexed: 0 };
    }

    let indexed = 0;
    for (let start = from; start <= safeTo; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, safeTo);
      const logs = await provider.getLogs({
        address: contractAddress,
        fromBlock: start,
        toBlock: end,
      });
      db.transaction(() => {
        for (const log of logs) {
          const decoded = decodeLog(log);
          if (!decoded) continue;
          const info = insertEvent.run(
            decoded.eventName,
            decoded.onChainId,
            log.transactionHash.toLowerCase(),
            log.index,
            log.blockNumber,
            JSON.stringify(decoded.payload),
            new Date().toISOString()
          );
          indexed += info.changes;
        }
        upsertState.run(end);
      })();
    }

    reconcile();
    return { from, to: safeTo, indexed };
  }

  /**
   * Settle pending rows against indexed events: a pending bounty/submission
   * becomes `confirmed` when its recorded tx hash (and hunter/hash for
   * submissions) matches the indexed event, `orphaned` when the chain
   * contradicts it. Rows without an indexed event yet stay pending.
   */
  function reconcile() {
    const setBountyStatus = db.prepare('UPDATE bounties SET status = ? WHERE on_chain_id = ?');
    for (const b of db
      .prepare("SELECT on_chain_id, create_tx_hash FROM bounties WHERE status = 'pending'")
      .all()) {
      const event = getLatestEvent(db, 'BountyCreated', b.on_chain_id);
      if (!event) continue;
      setBountyStatus.run(event.txHash === b.create_tx_hash ? 'confirmed' : 'orphaned', b.on_chain_id);
    }

    const setSubStatus = db.prepare('UPDATE submissions SET status = ? WHERE on_chain_id = ?');
    for (const s of db
      .prepare(
        "SELECT on_chain_id, hunter_address, content_hash, submit_tx_hash FROM submissions WHERE status = 'pending'"
      )
      .all()) {
      const event = getLatestEvent(db, 'WorkSubmitted', s.on_chain_id);
      if (!event) continue;
      const matches =
        event.txHash === s.submit_tx_hash &&
        event.payload.hunter === s.hunter_address &&
        event.payload.submissionHash === s.content_hash;
      setSubStatus.run(matches ? 'confirmed' : 'orphaned', s.on_chain_id);
    }
  }

  let timer = null;
  let running = false;

  /** Start the polling loop (one immediate pass, then every pollIntervalMs). */
  function start() {
    const tick = async () => {
      if (running) return; // never overlap passes
      running = true;
      try {
        const { from, to, indexed } = await indexOnce();
        if (indexed > 0) {
          logger.log(`[indexer] blocks ${from}-${to}: indexed ${indexed} event(s)`);
        }
      } catch (err) {
        logger.error(`[indexer] poll failed: ${err.message}`);
      } finally {
        running = false;
      }
    };
    void tick();
    timer = setInterval(tick, pollIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { indexOnce, reconcile, start, stop };
}

module.exports = { createIndexer, EVENT_ABI };
