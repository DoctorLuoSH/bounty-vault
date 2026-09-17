'use strict';

const express = require('express');
const { keccak256, toUtf8Bytes } = require('ethers');

const { getChainStates, getLatestEvent } = require('../db');
const { isAddress, isTxHash, isNonNegativeInt, isNonEmptyString } = require('../validate');

const CONTENT_MAX = 100000;

const isUniqueViolation = (err) =>
  err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT');

/**
 * Submission content routes (docs/ARCHITECTURE.md section 3.2). Mounted at
 * /api/bounties/:onChainId by src/index.js.
 */
module.exports = function submissionsRouter(db) {
  const router = express.Router({ mergeParams: true });

  // POST /api/bounties/:onChainId/submissions — store full submission text.
  // Hash convention (section 2.7): keccak256(utf8(content)) over the raw
  // string, no trimming or normalization. When the WorkSubmitted event is
  // already indexed, the row must match it exactly or is rejected with 422;
  // otherwise the row stays pending until indexer reconciliation.
  router.post('/submissions', (req, res) => {
    const onChainId = Number(req.params.onChainId);
    if (!isNonNegativeInt(onChainId)) {
      return res.status(400).json({ error: 'onChainId must be a non-negative integer' });
    }
    const { hunterAddress, content, submitTxHash } = req.body || {};
    if (!isAddress(hunterAddress)) {
      return res.status(400).json({ error: 'hunterAddress must be a 0x-prefixed 20-byte hex address' });
    }
    if (!isNonEmptyString(content, CONTENT_MAX)) {
      return res.status(400).json({ error: `content must be a non-empty string of at most ${CONTENT_MAX} characters` });
    }
    if (!isTxHash(submitTxHash)) {
      return res.status(400).json({ error: 'submitTxHash must be a 0x-prefixed 32-byte hex hash' });
    }

    const existing = db
      .prepare('SELECT status FROM submissions WHERE on_chain_id = ?')
      .get(onChainId);
    if (existing && existing.status !== 'orphaned') {
      return res.status(409).json({ error: 'a submission already exists for this bounty' });
    }
    if (existing) {
      // An orphaned (rejected) row may be replaced by a corrected re-post.
      db.prepare('DELETE FROM submissions WHERE on_chain_id = ?').run(onChainId);
    }

    const hunter = hunterAddress.toLowerCase();
    const txHash = submitTxHash.toLowerCase();
    const contentHash = keccak256(toUtf8Bytes(content));

    const event = getLatestEvent(db, 'WorkSubmitted', onChainId);
    let status = 'pending';
    if (event) {
      if (event.payload.submissionHash !== contentHash) {
        return res
          .status(422)
          .json({ error: 'content hash does not match the on-chain WorkSubmitted submissionHash' });
      }
      if (event.payload.hunter !== hunter) {
        return res
          .status(422)
          .json({ error: 'hunterAddress does not match the on-chain WorkSubmitted hunter' });
      }
      if (event.txHash !== txHash) {
        return res
          .status(422)
          .json({ error: 'submitTxHash does not match the on-chain WorkSubmitted transaction' });
      }
      status = 'confirmed';
    }

    try {
      db.prepare(
        `INSERT INTO submissions (on_chain_id, hunter_address, content, content_hash, submit_tx_hash, submitted_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(onChainId, hunter, content, contentHash, txHash, new Date().toISOString(), status);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'a submission already exists for this bounty or transaction' });
      }
      throw err;
    }

    return res.status(201).json({
      onChainId,
      hunterAddress: hunter,
      contentHash,
      submitTxHash: txHash,
      status,
    });
  });

  // GET /api/bounties/:onChainId/submission?address=0x... — full submission
  // text for the poster or the hunter only (MVP plain address check).
  router.get('/submission', (req, res) => {
    const onChainId = Number(req.params.onChainId);
    if (!isNonNegativeInt(onChainId)) {
      return res.status(400).json({ error: 'onChainId must be a non-negative integer' });
    }
    const { address } = req.query;
    if (!isAddress(address)) {
      return res
        .status(400)
        .json({ error: 'address query parameter must be a 0x-prefixed 20-byte hex address' });
    }

    const sub = db
      .prepare("SELECT * FROM submissions WHERE on_chain_id = ? AND status != 'orphaned'")
      .get(onChainId);
    if (!sub) {
      return res.status(404).json({ error: 'submission not found' });
    }

    const meta = db
      .prepare("SELECT poster_address FROM bounties WHERE on_chain_id = ? AND status != 'orphaned'")
      .get(onChainId);
    const poster = meta?.poster_address || getChainStates(db, onChainId).get(onChainId)?.poster || null;
    const requester = address.toLowerCase();
    if (requester !== sub.hunter_address && requester !== poster) {
      return res.status(403).json({ error: 'only the poster or the hunter can view the submission' });
    }

    return res.json({
      content: sub.content,
      contentHash: sub.content_hash,
      hunterAddress: sub.hunter_address,
      submittedAt: sub.submitted_at,
    });
  });

  return router;
};
