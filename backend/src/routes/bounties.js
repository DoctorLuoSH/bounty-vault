'use strict';

const express = require('express');

const { getChainStates, getLatestEvent } = require('../db');
const { isAddress, isTxHash, isNonNegativeInt, isNonEmptyString } = require('../validate');

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20000;
const CHAIN_STATUSES = new Set(['open', 'submitted', 'paid', 'cancelled']);

function serializeBounty(row, chain) {
  return {
    onChainId: row.on_chain_id,
    posterAddress: row.poster_address,
    title: row.title,
    description: row.description,
    createTxHash: row.create_tx_hash,
    createdAt: row.created_at,
    metadataStatus: row.status,
    chain: chain || null,
  };
}

const isUniqueViolation = (err) =>
  err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT');

/** Bounty metadata routes (docs/ARCHITECTURE.md section 3.2). */
module.exports = function bountiesRouter(db) {
  const router = express.Router();

  // POST /api/bounties — store off-chain metadata for an on-chain bounty.
  // Verified asynchronously by the indexer: accepted rows stay `pending`
  // until the matching BountyCreated event is indexed (`confirmed`) or
  // contradicted (`orphaned`). When the event is already indexed we can
  // confirm immediately.
  router.post('/', (req, res) => {
    const { onChainId, posterAddress, title, description, createTxHash } = req.body || {};
    if (!isNonNegativeInt(onChainId)) {
      return res.status(400).json({ error: 'onChainId must be a non-negative integer' });
    }
    if (!isAddress(posterAddress)) {
      return res.status(400).json({ error: 'posterAddress must be a 0x-prefixed 20-byte hex address' });
    }
    if (!isNonEmptyString(title, TITLE_MAX)) {
      return res.status(400).json({ error: `title must be a non-empty string of at most ${TITLE_MAX} characters` });
    }
    if (!isNonEmptyString(description, DESCRIPTION_MAX)) {
      return res.status(400).json({ error: `description must be a non-empty string of at most ${DESCRIPTION_MAX} characters` });
    }
    if (!isTxHash(createTxHash)) {
      return res.status(400).json({ error: 'createTxHash must be a 0x-prefixed 32-byte hex hash' });
    }

    const poster = posterAddress.toLowerCase();
    const txHash = createTxHash.toLowerCase();
    const event = getLatestEvent(db, 'BountyCreated', onChainId);
    const status = event && event.txHash === txHash && event.payload.poster === poster
      ? 'confirmed'
      : 'pending';

    try {
      db.prepare(
        `INSERT INTO bounties (on_chain_id, poster_address, title, description, create_tx_hash, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(onChainId, poster, title, description, txHash, new Date().toISOString(), status);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'metadata already exists for this onChainId or createTxHash' });
      }
      throw err;
    }

    const row = db.prepare('SELECT * FROM bounties WHERE on_chain_id = ?').get(onChainId);
    return res.status(201).json(serializeBounty(row, getChainStates(db, onChainId).get(onChainId)));
  });

  // GET /api/bounties?status=&poster=&hunter= — list metadata joined with the
  // latest indexed chain state. Orphaned rows are hidden (section 3.2).
  router.get('/', (req, res) => {
    const { status, poster, hunter } = req.query;
    if (status !== undefined && !CHAIN_STATUSES.has(status)) {
      return res.status(400).json({ error: 'status must be one of open, submitted, paid, cancelled' });
    }
    if (poster !== undefined && !isAddress(poster)) {
      return res.status(400).json({ error: 'poster must be a 0x-prefixed 20-byte hex address' });
    }
    if (hunter !== undefined && !isAddress(hunter)) {
      return res.status(400).json({ error: 'hunter must be a 0x-prefixed 20-byte hex address' });
    }

    const states = getChainStates(db);
    let rows = db
      .prepare("SELECT * FROM bounties WHERE status != 'orphaned' ORDER BY on_chain_id ASC")
      .all();
    if (poster !== undefined) {
      rows = rows.filter((r) => r.poster_address === poster.toLowerCase());
    }
    if (status !== undefined) {
      rows = rows.filter((r) => states.get(r.on_chain_id)?.status === status);
    }
    if (hunter !== undefined) {
      rows = rows.filter((r) => states.get(r.on_chain_id)?.hunterAddress === hunter.toLowerCase());
    }
    return res.json(rows.map((r) => serializeBounty(r, states.get(r.on_chain_id))));
  });

  // GET /api/bounties/:onChainId — single record incl. submission summary
  // (never the full submission content).
  router.get('/:onChainId', (req, res) => {
    const onChainId = Number(req.params.onChainId);
    if (!isNonNegativeInt(onChainId)) {
      return res.status(400).json({ error: 'onChainId must be a non-negative integer' });
    }
    const row = db
      .prepare("SELECT * FROM bounties WHERE on_chain_id = ? AND status != 'orphaned'")
      .get(onChainId);
    if (!row) {
      return res.status(404).json({ error: 'bounty not found' });
    }
    const body = serializeBounty(row, getChainStates(db, onChainId).get(onChainId));
    const sub = db
      .prepare("SELECT * FROM submissions WHERE on_chain_id = ? AND status != 'orphaned'")
      .get(onChainId);
    body.submission = sub
      ? {
          hunterAddress: sub.hunter_address,
          contentHash: sub.content_hash,
          submittedAt: sub.submitted_at,
          status: sub.status,
        }
      : null;
    return res.json(body);
  });

  return router;
};
