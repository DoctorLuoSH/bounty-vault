// End-to-end check of the frontend's contract/data layer against a local
// Hardhat node, walking the four PRD flows F1-F4 with two accounts.
//
// Prerequisites:
//   1. cd ../contracts && npm install && npx hardhat compile
//   2. npx hardhat node            (leave running on 127.0.0.1:8545)
//   3. cd ../frontend && npm install
// Run: npm run test:e2e
//
// The script deploys a fresh BountyVault, then drives it exclusively through
// the app's own modules (lib/contract.js + lib/data.js in "chain" source mode),
// so a green run means the UI's on-chain paths work as coded.
import { ContractFactory, Interface, JsonRpcProvider, formatEther, parseEther } from "ethers";

process.env.VITE_CHAIN_ID ||= "31337";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";

let failures = 0;
function check(label, condition, extra = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const artifact = (
    await import("../../contracts/artifacts/contracts/BountyVault.sol/BountyVault.json", {
      with: { type: "json" },
    })
  ).default;

  const provider = new JsonRpcProvider(RPC_URL);
  const poster = await provider.getSigner(0);
  const hunter = await provider.getSigner(1);

  // Deploy a fresh contract, then point the app's config at it.
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, poster);
  const deployment = await factory.deploy();
  await deployment.waitForDeployment();
  process.env.VITE_CONTRACT_ADDRESS = await deployment.getAddress();
  console.log(`Deployed BountyVault at ${process.env.VITE_CONTRACT_ADDRESS}\n`);

  // Import the app's modules only AFTER env is set (config.js reads it once).
  const { getReadContract, getWriteContract, computeSubmissionHash, parseEventFromReceipt, BountyStatus, describeTxError } =
    await import("../src/lib/contract.js");
  const { loadBountyList, loadBountyDetail } = await import("../src/lib/data.js");

  const readContract = getReadContract(provider);
  const posterContract = getWriteContract(poster);
  const hunterContract = getWriteContract(hunter);

  // ABI sanity: the app ships a human-readable ABI; it must match the artifact.
  const artifactIface = new Interface(artifact.abi);
  check("ABI encodes the same selectors as the artifact",
    ["createBounty", "submitWork", "approveSubmission", "cancelBounty", "getBounty", "bountyCount"]
      .every((name) =>
        readContract.interface.getFunction(name).selector === artifactIface.getFunction(name).selector));

  // --- F1: create & fund -----------------------------------------------------
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const tx1 = await posterContract.createBounty(deadline, { value: parseEther("0.01") });
  const receipt1 = await tx1.wait();
  const created = parseEventFromReceipt(receipt1, "BountyCreated");
  check("F1 createBounty emits BountyCreated with id 0", created && Number(created.bountyId) === 0);
  check("F1 escrowed amount matches msg.value", created && formatEther(created.amount) === "0.01");

  let list = await loadBountyList({ source: "chain", readContract, status: "open" });
  check("F1 list (chain source) shows the new open bounty", list.length === 1 && list[0].status === BountyStatus.Open);

  // --- F2: submit work -------------------------------------------------------
  // Error decoding happens on the still-Open bounty: the poster cannot submit.
  try {
    await posterContract.submitWork.staticCall(0, computeSubmissionHash("x"));
    check("Error decoding: PosterCannotSubmit surfaces", false);
  } catch (err) {
    check("Error decoding: PosterCannotSubmit surfaces",
      describeTxError(err).includes("poster cannot submit"));
  }

  const content = "The deliverable: https://example.com/work/42\nDone.";
  const hash = computeSubmissionHash(content);
  const tx2 = await hunterContract.submitWork(0, hash);
  await tx2.wait();

  let detail = await loadBountyDetail({ source: "chain", readContract, id: 0 });
  check("F2 bounty moved to Submitted with hunter + hash recorded",
    detail.status === BountyStatus.Submitted &&
    detail.hunter.toLowerCase() === (await hunter.getAddress()).toLowerCase() &&
    detail.submissionHash === hash);

  // --- F3: approve & pay -----------------------------------------------------
  // Balances are read at explicit block numbers: JsonRpcProvider briefly
  // caches "latest"/"pending" right after a tx is mined.
  const tx3 = await posterContract.approveSubmission(0);
  const receipt3 = await tx3.wait();
  const paid = parseEventFromReceipt(receipt3, "BountyPaid");
  const hunterAddr = await hunter.getAddress();
  const hunterAfter = await provider.getBalance(hunterAddr, receipt3.blockNumber);
  const hunterBefore = await provider.getBalance(hunterAddr, receipt3.blockNumber - 1);
  detail = await loadBountyDetail({ source: "chain", readContract, id: 0 });
  check("F3 approveSubmission pays the full escrow to the hunter",
    paid && hunterAfter - hunterBefore === paid.amount && formatEther(paid.amount) === "0.01");
  check("F3 bounty is Paid (terminal)", detail.status === BountyStatus.Paid);

  // --- F4: cancel & refund ---------------------------------------------------
  const tx4 = await posterContract.createBounty(deadline, { value: parseEther("0.005") });
  await tx4.wait();
  const tx5 = await posterContract.cancelBounty(1);
  const receipt5 = await tx5.wait();
  const cancelled = parseEventFromReceipt(receipt5, "BountyCancelled");
  const posterAddr = await poster.getAddress();
  const posterAfter = await provider.getBalance(posterAddr, receipt5.blockNumber);
  const posterBefore = await provider.getBalance(posterAddr, receipt5.blockNumber - 1);
  detail = await loadBountyDetail({ source: "chain", readContract, id: 1 });
  check("F4 cancelBounty refunds the full escrow (minus gas)",
    cancelled &&
    formatEther(cancelled.refundAmount) === "0.005" &&
    posterAfter - posterBefore > parseEther("0.0049"));
  check("F4 bounty is Cancelled (terminal)", detail.status === BountyStatus.Cancelled);

  // Filters used by the list and dashboard pages.
  list = await loadBountyList({ source: "chain", readContract, status: "cancelled" });
  check("Status filter returns only cancelled bounties", list.length === 1 && list[0].id === 1);
  list = await loadBountyList({ source: "chain", readContract, hunter: await hunter.getAddress() });
  check("Hunter filter returns bounties the hunter submitted to", list.length === 1 && list[0].id === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
