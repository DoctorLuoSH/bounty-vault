'use strict';

// Re-seeds the off-chain metadata (title / description) of the three demo
// bounties that live on the Sepolia deployment
// (0x9dD555CB8962D4c89e1331DBCE5D470370ae60a7, see README "Seeded demo data").
//
// Why this is needed: metadata is stored only in the backend's local SQLite
// database (and the creator's browser localStorage). A fresh checkout starts
// with an empty database, and the indexer only replays on-chain events, so
// the demo bounties show up without title/description until this script POSTs
// the metadata to the local backend.
//
// Usage (backend running on http://localhost:3001):
//   node scripts/seed-demo-metadata.js
// Override the API base URL with API_BASE_URL, e.g.
//   API_BASE_URL=http://localhost:3001/api node scripts/seed-demo-metadata.js
//
// The script is idempotent: rows that already exist (HTTP 409) are skipped.
//
// Note: titles and createTxHash values match the DAPP-5 deployment record
// verbatim; descriptions were not preserved from the original seeding run and
// are reconstructed to match the titles.

const API_BASE_URL = (process.env.API_BASE_URL || 'http://localhost:3001/api').replace(/\/$/, '');

const POSTER = '0x4D986914C39a07e292E3A9194346be75Fb6C4E4D'; // team test account (deployer)

const DEMO_BOUNTIES = [
  {
    onChainId: 0,
    posterAddress: POSTER,
    title: 'Design the BountyVault landing-page hero section',
    description:
      'Design a hero section for the BountyVault landing page: a headline, a one-sentence ' +
      'pitch for escrow-backed bounties, and a primary call-to-action linking to the bounty ' +
      'list. Deliver a Figma frame or exported PNG/SVG assets that work at desktop and mobile widths.',
    createTxHash: '0x3623bf66e6bc6a48290b102450c98e7fd99ac0ba5c309d5dcc2086fdb47d60e4',
  },
  {
    onChainId: 1,
    posterAddress: POSTER,
    title: 'Write Hardhat tests for indexer reorg edge cases',
    description:
      'Add Hardhat test cases covering the event indexer under chain reorgs: events that drop ' +
      'out of the canonical chain, checkpoint rollback, and rows that must flip from confirmed ' +
      'back to pending or orphaned. Include at least one test per edge case.',
    createTxHash: '0xec0b125ac2a1afca121b1a7a915f056e1f6f365d9460c668d12af4dbfa0e7075',
  },
  {
    onChainId: 2,
    posterAddress: POSTER,
    title: 'Record a 30-second GIF of the wallet-connect flow',
    description:
      'Record a ~30-second GIF of the MetaMask wallet-connect flow on the Sepolia deployment: ' +
      'clicking Connect wallet, the network-switch prompt when MetaMask is not on Sepolia, and ' +
      'the connected state in the header. Deliver an embeddable GIF under 10 MB.',
    createTxHash: '0xde7e13a302a8856e9bf9b68fba6072b3938c3f6f1569c19a924f65e0c082840a',
  },
];

async function main() {
  let failures = 0;
  for (const bounty of DEMO_BOUNTIES) {
    let res;
    try {
      res = await fetch(`${API_BASE_URL}/bounties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bounty),
      });
    } catch (err) {
      console.error(`[seed] bounty ${bounty.onChainId}: request failed — is the backend running at ${API_BASE_URL}? (${err.message})`);
      failures += 1;
      continue;
    }
    if (res.status === 201) {
      const body = await res.json();
      console.log(`[seed] bounty ${bounty.onChainId}: created (metadataStatus=${body.metadataStatus}) — "${bounty.title}"`);
    } else if (res.status === 409) {
      await res.arrayBuffer();
      console.log(`[seed] bounty ${bounty.onChainId}: already present, skipped`);
    } else {
      const text = await res.text();
      console.error(`[seed] bounty ${bounty.onChainId}: unexpected ${res.status} ${text}`);
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`[seed] ${failures} of ${DEMO_BOUNTIES.length} bounties failed to seed`);
    process.exit(1);
  }
  console.log('[seed] done — demo metadata is in place');
}

main();
