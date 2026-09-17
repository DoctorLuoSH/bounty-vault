'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const express = require('express');
const { JsonRpcProvider } = require('ethers');

const { createDatabase } = require('./db');
const { createIndexer } = require('./indexer');
const bountiesRouter = require('./routes/bounties');
const submissionsRouter = require('./routes/submissions');
const { isAddress } = require('./validate');

/** Build the Express app (docs/ARCHITECTURE.md section 3.2; base path /api). */
function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/bounties', bountiesRouter(db));
  app.use('/api/bounties/:onChainId', submissionsRouter(db));

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request body too large' });
    }
    console.error(err);
    return res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function main() {
  const port = envInt('PORT', 3001);
  const dbPath = process.env.DATABASE_PATH || './data/bountyvault.db';
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = createDatabase(dbPath);
  const server = createApp(db).listen(port, () => {
    console.log(`[api] BountyVault backend listening on http://localhost:${port}`);
  });

  // Event indexer (docs/ARCHITECTURE.md section 3.3). The backend holds no
  // keys and never writes on-chain; it only polls eth_getLogs.
  const indexerEnabled = (process.env.INDEXER_ENABLED || 'true') !== 'false';
  const contractAddress = process.env.CONTRACT_ADDRESS || '';
  let indexer = null;
  if (indexerEnabled && isAddress(contractAddress)) {
    indexer = createIndexer({
      db,
      provider: new JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545'),
      contractAddress,
      deploymentBlock: envInt('DEPLOYMENT_BLOCK', 0),
      confirmations: envInt('INDEXER_CONFIRMATIONS', 12),
      pollIntervalMs: envInt('INDEXER_POLL_INTERVAL_MS', 15000),
      chunkSize: envInt('INDEXER_BLOCK_CHUNK', 2000),
    });
    indexer.start();
    console.log(`[indexer] polling ${contractAddress} every ${envInt('INDEXER_POLL_INTERVAL_MS', 15000)} ms`);
  } else if (indexerEnabled) {
    console.warn('[indexer] CONTRACT_ADDRESS missing or invalid; event indexing disabled (API only).');
  }

  const shutdown = () => {
    console.log('shutting down...');
    if (indexer) indexer.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main();
}

module.exports = { createApp };
