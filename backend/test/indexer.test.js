'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Interface, keccak256, toUtf8Bytes } = require('ethers');

const { createDatabase } = require('../src/db');
const { createIndexer, EVENT_ABI } = require('../src/indexer');

const iface = new Interface(EVENT_ABI);
const CONTRACT = '0x' + '44'.repeat(20);
const POSTER = '0x' + '1a'.repeat(20);
const HUNTER = '0x' + 'ab'.repeat(20);

function makeLog(eventName, values, { blockNumber, txHash, logIndex }) {
  const { topics, data } = iface.encodeEventLog(iface.getEvent(eventName), values);
  return { address: CONTRACT, topics, data, blockNumber, transactionHash: txHash, index: logIndex };
}

/** Minimal stand-in for an ethers JsonRpcProvider (getBlockNumber + getLogs). */
class FakeProvider {
  constructor(latest, logs) {
    this.latest = latest;
    this.logs = logs;
    this.calls = [];
  }

  async getBlockNumber() {
    return this.latest;
  }

  async getLogs({ fromBlock, toBlock }) {
    this.calls.push({ fromBlock, toBlock });
    return this.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
  }
}

const tx = (n) => '0x' + n.toString(16).padStart(64, '0');
const hash = (s) => keccak256(toUtf8Bytes(s));

function eventRows(db) {
  return db.prepare('SELECT * FROM chain_events ORDER BY block_number, log_index').all();
}

function freshIndexer(db, provider, overrides = {}) {
  return createIndexer({ db, provider, contractAddress: CONTRACT, ...overrides });
}

test('indexes logs up to latest - confirmations and advances the checkpoint', async () => {
  const db = createDatabase(':memory:');
  const logs = [
    makeLog('BountyCreated', [0n, POSTER, 1000n, 1730000000n], { blockNumber: 50, txHash: tx(1), logIndex: 0 }),
    makeLog('WorkSubmitted', [0n, HUNTER, hash('result')], { blockNumber: 60, txHash: tx(2), logIndex: 0 }),
    makeLog('BountyPaid', [0n, HUNTER, 1000n], { blockNumber: 70, txHash: tx(3), logIndex: 0 }),
    makeLog('BountyCreated', [1n, POSTER, 2000n, 1730000500n], { blockNumber: 80, txHash: tx(4), logIndex: 0 }),
    makeLog('BountyCancelled', [1n, 2000n], { blockNumber: 85, txHash: tx(5), logIndex: 0 }),
    makeLog('BountyCreated', [2n, POSTER, 5n, 1730000600n], { blockNumber: 95, txHash: tx(6), logIndex: 0 }),
  ];
  const provider = new FakeProvider(100, logs);
  const indexer = freshIndexer(db, provider, { confirmations: 12, deploymentBlock: 40 });

  const result = await indexer.indexOnce();
  assert.deepEqual(result, { from: 40, to: 88, indexed: 5 }); // block 95 is not 12-deep yet

  const rows = eventRows(db);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.event_name), [
    'BountyCreated',
    'WorkSubmitted',
    'BountyPaid',
    'BountyCreated',
    'BountyCancelled',
  ]);
  assert.equal(rows[0].tx_hash, tx(1));
  assert.deepEqual(JSON.parse(rows[0].payload), {
    poster: POSTER.toLowerCase(),
    amount: '1000',
    deadline: 1730000000,
  });
  assert.deepEqual(JSON.parse(rows[1].payload), {
    hunter: HUNTER.toLowerCase(),
    submissionHash: hash('result'),
  });
  assert.deepEqual(JSON.parse(rows[4].payload), { refundAmount: '2000' });
  assert.equal(db.prepare('SELECT last_block FROM indexer_state WHERE id = 1').get().last_block, 88);

  // Nothing new until the chain head moves past confirmations.
  assert.deepEqual(await indexer.indexOnce(), { from: 89, to: 88, indexed: 0 });
  provider.latest = 110;
  const second = await indexer.indexOnce();
  assert.equal(second.indexed, 1); // now the block-95 log is deep enough
  assert.equal(eventRows(db).length, 6);
  db.close();
});

test('re-indexing the same range is idempotent (UNIQUE(tx_hash, log_index))', async () => {
  const db = createDatabase(':memory:');
  const logs = [
    makeLog('BountyCreated', [0n, POSTER, 1000n, 1730000000n], { blockNumber: 50, txHash: tx(1), logIndex: 0 }),
    makeLog('WorkSubmitted', [0n, HUNTER, hash('result')], { blockNumber: 50, txHash: tx(2), logIndex: 1 }),
  ];
  const provider = new FakeProvider(100, logs);
  const indexer = freshIndexer(db, provider, { confirmations: 12, deploymentBlock: 0 });

  await indexer.indexOnce();
  assert.equal(eventRows(db).length, 2);

  // Rewind the checkpoint and rebuild the same range (crash recovery path).
  db.prepare('UPDATE indexer_state SET last_block = 0 WHERE id = 1').run();
  const again = await indexer.indexOnce();
  assert.equal(again.indexed, 0);
  assert.equal(eventRows(db).length, 2);
  assert.equal(db.prepare('SELECT last_block FROM indexer_state WHERE id = 1').get().last_block, 88);
  db.close();
});

test('fetches logs in bounded chunks', async () => {
  const db = createDatabase(':memory:');
  const provider = new FakeProvider(112, []);
  const indexer = freshIndexer(db, provider, { confirmations: 12, deploymentBlock: 0, chunkSize: 25 });

  await indexer.indexOnce(); // safe range 0..100 -> 25,25,25,25,1
  assert.deepEqual(
    provider.calls,
    [
      { fromBlock: 0, toBlock: 24 },
      { fromBlock: 25, toBlock: 49 },
      { fromBlock: 50, toBlock: 74 },
      { fromBlock: 75, toBlock: 99 },
      { fromBlock: 100, toBlock: 100 },
    ]
  );
  db.close();
});

test('no-op when fewer than `confirmations` blocks exist', async () => {
  const db = createDatabase(':memory:');
  const provider = new FakeProvider(5, []);
  const indexer = freshIndexer(db, provider, { confirmations: 12, deploymentBlock: 0 });
  assert.deepEqual(await indexer.indexOnce(), { from: 0, to: -1, indexed: 0 });
  db.close();
});

test('reconcile confirms matching rows and orphans contradicting ones', async () => {
  const db = createDatabase(':memory:');
  const logs = [
    makeLog('BountyCreated', [0n, POSTER, 1000n, 1730000000n], { blockNumber: 50, txHash: tx(1), logIndex: 0 }),
    makeLog('BountyCreated', [1n, POSTER, 1000n, 1730000000n], { blockNumber: 51, txHash: tx(2), logIndex: 0 }),
    makeLog('WorkSubmitted', [0n, HUNTER, hash('result')], { blockNumber: 60, txHash: tx(3), logIndex: 0 }),
    makeLog('WorkSubmitted', [1n, HUNTER, hash('result')], { blockNumber: 61, txHash: tx(4), logIndex: 0 }),
  ];
  const provider = new FakeProvider(100, logs);
  const indexer = freshIndexer(db, provider, { confirmations: 12, deploymentBlock: 0 });

  const insertBounty = db.prepare(
    `INSERT INTO bounties (on_chain_id, poster_address, title, description, create_tx_hash, created_at, status)
     VALUES (?, ?, 't', 'd', ?, ?, 'pending')`
  );
  const insertSub = db.prepare(
    `INSERT INTO submissions (on_chain_id, hunter_address, content, content_hash, submit_tx_hash, submitted_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  );
  const now = new Date().toISOString();
  insertBounty.run(0, POSTER.toLowerCase(), tx(1), now); // matches -> confirmed
  insertBounty.run(1, POSTER.toLowerCase(), tx(9), now); // wrong tx -> orphaned
  insertBounty.run(2, POSTER.toLowerCase(), tx(8), now); // no event -> pending
  insertSub.run(0, HUNTER.toLowerCase(), 'result', hash('result'), tx(3), now); // matches -> confirmed
  insertSub.run(1, HUNTER.toLowerCase(), 'tampered', hash('tampered'), tx(4), now); // hash mismatch -> orphaned

  await indexer.indexOnce();

  const bounties = db.prepare('SELECT on_chain_id, status FROM bounties ORDER BY on_chain_id').all();
  assert.deepEqual(bounties, [
    { on_chain_id: 0, status: 'confirmed' },
    { on_chain_id: 1, status: 'orphaned' },
    { on_chain_id: 2, status: 'pending' },
  ]);
  const subs = db.prepare('SELECT on_chain_id, status FROM submissions ORDER BY on_chain_id').all();
  assert.deepEqual(subs, [
    { on_chain_id: 0, status: 'confirmed' },
    { on_chain_id: 1, status: 'orphaned' },
  ]);
  db.close();
});

test('first boot starts from DEPLOYMENT_BLOCK, not from genesis', async () => {
  const db = createDatabase(':memory:');
  const logs = [
    makeLog('BountyCreated', [0n, POSTER, 1000n, 1730000000n], { blockNumber: 30, txHash: tx(1), logIndex: 0 }),
    makeLog('BountyCreated', [1n, POSTER, 1000n, 1730000000n], { blockNumber: 70, txHash: tx(2), logIndex: 0 }),
  ];
  const provider = new FakeProvider(100, logs);
  const indexer = freshIndexer(db, provider, { confirmations: 12, deploymentBlock: 60 });

  await indexer.indexOnce();
  const rows = eventRows(db);
  assert.equal(rows.length, 1); // the block-30 log predates the deployment block
  assert.equal(rows[0].on_chain_id, 1);
  db.close();
});
