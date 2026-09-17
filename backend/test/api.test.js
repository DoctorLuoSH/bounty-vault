'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { keccak256, toUtf8Bytes } = require('ethers');

const { createDatabase } = require('../src/db');
const { createIndexer } = require('../src/indexer');
const { createApp } = require('../src/index');

const POSTER = '0x' + '1a'.repeat(20);
const HUNTER = '0x' + 'ab'.repeat(20);
const STRANGER = '0x' + 'cc'.repeat(20);
const CREATE_TX = '0x' + 'aa'.repeat(32);
const SUBMIT_TX = '0x' + 'bb'.repeat(32);
const OTHER_TX = '0x' + 'cc'.repeat(32);

let db;
let server;
let base;

function seedEvent({ eventName, onChainId, txHash, logIndex = 0, blockNumber = 100, payload }) {
  db.prepare(
    `INSERT INTO chain_events (event_name, on_chain_id, tx_hash, log_index, block_number, payload, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(eventName, onChainId, txHash, logIndex, blockNumber, JSON.stringify(payload), new Date().toISOString());
}

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const validBounty = (overrides = {}) => ({
  onChainId: 0,
  posterAddress: POSTER,
  title: 'Write tests',
  description: 'Cover the bounty state machine',
  createTxHash: CREATE_TX,
  ...overrides,
});

before(async () => {
  db = createDatabase(':memory:');
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

test('GET /api/health returns ok', async () => {
  const { status, body } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'ok' });
});

test('POST /api/bounties validates input', async () => {
  const bad = [
    { ...validBounty(), onChainId: -1 },
    { ...validBounty(), onChainId: '0' },
    { ...validBounty({ onChainId: 1 }), posterAddress: 'not-an-address' },
    { ...validBounty({ onChainId: 1 }), title: '' },
    { ...validBounty({ onChainId: 1 }), description: 42 },
    { ...validBounty({ onChainId: 1 }), createTxHash: '0x1234' },
  ];
  for (const body of bad) {
    const { status } = await api('POST', '/api/bounties', body);
    assert.equal(status, 400, JSON.stringify(body));
  }
});

test('POST /api/bounties stores pending metadata; duplicates conflict', async () => {
  const created = await api('POST', '/api/bounties', validBounty());
  assert.equal(created.status, 201);
  assert.equal(created.body.metadataStatus, 'pending');
  assert.equal(created.body.posterAddress, POSTER.toLowerCase());
  assert.equal(created.body.chain, null);

  const dupId = await api('POST', '/api/bounties', validBounty({ createTxHash: OTHER_TX }));
  assert.equal(dupId.status, 409);
  const dupTx = await api('POST', '/api/bounties', validBounty({ onChainId: 1 }));
  assert.equal(dupTx.status, 409);
});

test('POST /api/bounties confirms immediately when the event is indexed', async () => {
  const createTx5 = '0x' + 'a5'.repeat(32);
  seedEvent({
    eventName: 'BountyCreated',
    onChainId: 5,
    txHash: createTx5,
    payload: { poster: POSTER.toLowerCase(), amount: '1000', deadline: 1730000000 },
  });
  const { status, body } = await api('POST', '/api/bounties', validBounty({ onChainId: 5, createTxHash: createTx5 }));
  assert.equal(status, 201);
  assert.equal(body.metadataStatus, 'confirmed');
  assert.equal(body.chain.status, 'open');
  assert.equal(body.chain.amount, '1000');
  assert.equal(body.chain.deadline, 1730000000);
});

test('GET /api/bounties filters by status, poster and hunter', async () => {
  // id 5: open (seeded above). Add id 6 with an indexed submission.
  seedEvent({
    eventName: 'BountyCreated',
    onChainId: 6,
    txHash: OTHER_TX,
    logIndex: 0,
    blockNumber: 101,
    payload: { poster: STRANGER.toLowerCase(), amount: '2000', deadline: 1730000100 },
  });
  seedEvent({
    eventName: 'WorkSubmitted',
    onChainId: 6,
    txHash: SUBMIT_TX,
    logIndex: 1,
    blockNumber: 102,
    payload: { hunter: HUNTER.toLowerCase(), submissionHash: keccak256(toUtf8Bytes('result')) },
  });
  await api('POST', '/api/bounties', validBounty({
    onChainId: 6,
    posterAddress: STRANGER,
    createTxHash: OTHER_TX,
  }));

  const bad = await api('GET', '/api/bounties?status=draft');
  assert.equal(bad.status, 400);
  const badPoster = await api('GET', '/api/bounties?poster=0x0');
  assert.equal(badPoster.status, 400);

  const all = await api('GET', '/api/bounties');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.map((b) => b.onChainId), [0, 5, 6]);

  const open = await api('GET', '/api/bounties?status=open');
  assert.deepEqual(open.body.map((b) => b.onChainId), [5]);
  const submitted = await api('GET', '/api/bounties?status=submitted');
  assert.deepEqual(submitted.body.map((b) => b.onChainId), [6]);

  const byPoster = await api('GET', `/api/bounties?poster=${POSTER}`);
  assert.deepEqual(byPoster.body.map((b) => b.onChainId).sort(), [0, 5]);
  const byPosterMixedCase = await api('GET', `/api/bounties?poster=${POSTER.toUpperCase().replace('0X', '0x')}`);
  assert.equal(byPosterMixedCase.status, 200);
  const byHunter = await api('GET', `/api/bounties?hunter=${HUNTER}`);
  assert.deepEqual(byHunter.body.map((b) => b.onChainId), [6]);
});

test('GET /api/bounties/:onChainId returns record with submission summary', async () => {
  const missing = await api('GET', '/api/bounties/999');
  assert.equal(missing.status, 404);
  const garbage = await api('GET', '/api/bounties/abc');
  assert.equal(garbage.status, 400);

  const { status, body } = await api('GET', '/api/bounties/6');
  assert.equal(status, 200);
  assert.equal(body.chain.status, 'submitted');
  assert.equal(body.chain.hunterAddress, HUNTER.toLowerCase());
  assert.equal(body.submission, null); // no stored submission row yet
});

test('POST submissions: hash convention, 422 mismatch, 201 confirmed, 409 duplicate', async () => {
  // Bounty 6 has WorkSubmitted indexed with hash of "result" (seeded above).
  const mismatch = await api('POST', '/api/bounties/6/submissions', {
    hunterAddress: HUNTER,
    content: 'result ',
    submitTxHash: SUBMIT_TX,
  });
  assert.equal(mismatch.status, 422);

  const wrongHunter = await api('POST', '/api/bounties/6/submissions', {
    hunterAddress: STRANGER,
    content: 'result',
    submitTxHash: SUBMIT_TX,
  });
  assert.equal(wrongHunter.status, 422);

  const wrongTx = await api('POST', '/api/bounties/6/submissions', {
    hunterAddress: HUNTER,
    content: 'result',
    submitTxHash: CREATE_TX,
  });
  assert.equal(wrongTx.status, 422);

  // Exact raw string, no trimming: hash matches the on-chain value.
  const ok = await api('POST', '/api/bounties/6/submissions', {
    hunterAddress: HUNTER,
    content: 'result',
    submitTxHash: SUBMIT_TX,
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, 'confirmed');
  assert.equal(ok.body.contentHash, keccak256(toUtf8Bytes('result')));

  const dup = await api('POST', '/api/bounties/6/submissions', {
    hunterAddress: HUNTER,
    content: 'result',
    submitTxHash: SUBMIT_TX,
  });
  assert.equal(dup.status, 409);

  // No indexed WorkSubmitted for bounty 5: accepted as pending.
  const pending = await api('POST', '/api/bounties/5/submissions', {
    hunterAddress: HUNTER,
    content: 'anything',
    submitTxHash: '0x' + 'dd'.repeat(32),
  });
  assert.equal(pending.status, 201);
  assert.equal(pending.body.status, 'pending');

  const detail = await api('GET', '/api/bounties/6');
  assert.equal(detail.body.submission.hunterAddress, HUNTER.toLowerCase());
  assert.equal(detail.body.submission.status, 'confirmed');
  assert.equal(detail.body.submission.content, undefined); // summary only
});

test('POST submissions validates input', async () => {
  const bad = [
    { hunterAddress: '0x0', content: 'x', submitTxHash: SUBMIT_TX },
    { hunterAddress: HUNTER, content: '', submitTxHash: SUBMIT_TX },
    { hunterAddress: HUNTER, content: 'x', submitTxHash: 'nope' },
  ];
  for (const body of bad) {
    const { status } = await api('POST', '/api/bounties/5/submissions', body);
    assert.equal(status, 400, JSON.stringify(body));
  }
  const badId = await api('POST', '/api/bounties/xyz/submissions', {
    hunterAddress: HUNTER,
    content: 'x',
    submitTxHash: SUBMIT_TX,
  });
  assert.equal(badId.status, 400);
});

test('GET submission is restricted to poster and hunter', async () => {
  // Bounty 6: poster = STRANGER (0x33..), hunter = HUNTER (0x22..); the
  // submission row was stored by the earlier test.
  const noAddress = await api('GET', '/api/bounties/6/submission');
  assert.equal(noAddress.status, 400);
  const missing = await api('GET', `/api/bounties/0/submission?address=${POSTER}`);
  assert.equal(missing.status, 404);
  const stranger = await api('GET', `/api/bounties/6/submission?address=${POSTER}`);
  assert.equal(stranger.status, 403);

  const poster = await api('GET', `/api/bounties/6/submission?address=${STRANGER}`);
  assert.equal(poster.status, 200);
  assert.equal(poster.body.content, 'result');
  assert.equal(poster.body.contentHash, keccak256(toUtf8Bytes('result')));
  assert.equal(poster.body.hunterAddress, HUNTER.toLowerCase());
  assert.ok(poster.body.submittedAt);

  // Address comparison is case-insensitive (stored lowercase).
  const hunterMixedCase = '0x' + 'AB'.repeat(20);
  const hunter = await api('GET', `/api/bounties/6/submission?address=${hunterMixedCase}`);
  assert.equal(hunter.status, 200);
  assert.equal(hunter.body.content, 'result');
});

test('orphaned rows are hidden from list and detail', async () => {
  // Chain says bounty 7 was created by one tx; the metadata claims another.
  const realTx = '0x' + 'a7'.repeat(32);
  const claimedTx = '0x' + 'b7'.repeat(32);
  seedEvent({
    eventName: 'BountyCreated',
    onChainId: 7,
    txHash: realTx,
    logIndex: 0,
    blockNumber: 110,
    payload: { poster: POSTER.toLowerCase(), amount: '5', deadline: 1730000200 },
  });
  const posted = await api('POST', '/api/bounties', validBounty({ onChainId: 7, createTxHash: claimedTx }));
  assert.equal(posted.body.metadataStatus, 'pending');

  createIndexer({ db, provider: null, contractAddress: '0x' + '44'.repeat(20) }).reconcile();

  const detail = await api('GET', '/api/bounties/7');
  assert.equal(detail.status, 404);
  const list = await api('GET', '/api/bounties');
  assert.ok(!list.body.some((b) => b.onChainId === 7));
});
