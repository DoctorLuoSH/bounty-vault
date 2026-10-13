const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// enum BountyStatus { Open, Paid, Cancelled }
const STATUS = { Open: 0, Paid: 1, Cancelled: 2 };

const ONE_DAY = 24 * 60 * 60;
const REVIEW_PERIOD = 7 * ONE_DAY;
const AMOUNT = ethers.parseEther("1");
const ZERO_HASH = ethers.ZeroHash;
const hashOf = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));
const METADATA_HASH = hashOf("Build the docs site for our token launch");
const SUBMISSION_A = hashOf("delivery A: https://example.com/a.zip");
const SUBMISSION_A2 = hashOf("delivery A revised: https://example.com/a2.zip");
const SUBMISSION_B = hashOf("delivery B: https://example.com/b.zip");
const SUBMISSION_C = hashOf("delivery C: https://example.com/c.zip");
const REENTRANCY_GUARD_ERROR_SELECTOR = ethers
  .id("ReentrancyGuardReentrantCall()")
  .slice(0, 10);

describe("BountyVaultV2", function () {
  async function deployFixture() {
    const [poster, hunter, hunter2, hunter3, other] = await ethers.getSigners();
    const BountyVaultV2 = await ethers.getContractFactory("BountyVaultV2");
    const vault = await BountyVaultV2.deploy();
    return { vault, poster, hunter, hunter2, hunter3, other };
  }

  async function createOpenBounty(vault, poster, overrides = {}) {
    const deadline =
      overrides.deadline ?? BigInt((await time.latest()) + ONE_DAY);
    const amount = overrides.amount ?? AMOUNT;
    const metadataHash = overrides.metadataHash ?? METADATA_HASH;
    const tx = await vault
      .connect(poster)
      .createBounty(deadline, metadataHash, { value: amount });
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return vault.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "BountyCreated");
    return { deadline, amount, metadataHash, bountyId: event.args.bountyId };
  }

  async function openBountyFixture() {
    const base = await deployFixture();
    const bounty = await createOpenBounty(base.vault, base.poster);
    return { ...base, ...bounty };
  }

  // One submission from `hunter`.
  async function submittedBountyFixture() {
    const base = await openBountyFixture();
    await base.vault.connect(base.hunter).submitWork(base.bountyId, SUBMISSION_A);
    return base;
  }

  // Three submissions: hunter -> index 0, hunter2 -> index 1, hunter3 -> index 2.
  async function contestedBountyFixture() {
    const base = await openBountyFixture();
    await base.vault.connect(base.hunter).submitWork(base.bountyId, SUBMISSION_A);
    await base.vault.connect(base.hunter2).submitWork(base.bountyId, SUBMISSION_B);
    await base.vault.connect(base.hunter3).submitWork(base.bountyId, SUBMISSION_C);
    return base;
  }

  describe("createBounty", function () {
    it("stores the bounty with its metadataHash and emits BountyCreated", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);

      await expect(
        vault.connect(poster).createBounty(deadline, METADATA_HASH, { value: AMOUNT })
      )
        .to.emit(vault, "BountyCreated")
        .withArgs(0, poster.address, AMOUNT, deadline, METADATA_HASH);

      const bounty = await vault.getBounty(0);
      expect(bounty.poster).to.equal(poster.address);
      expect(bounty.amount).to.equal(AMOUNT);
      expect(bounty.deadline).to.equal(deadline);
      expect(bounty.status).to.equal(STATUS.Open);
      expect(bounty.metadataHash).to.equal(METADATA_HASH);
      expect(await vault.bountyCount()).to.equal(1);
    });

    it("allows a zero metadataHash (no off-chain commitment)", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);
      await vault.connect(poster).createBounty(deadline, ZERO_HASH, { value: AMOUNT });
      expect((await vault.getBounty(0)).metadataHash).to.equal(ZERO_HASH);
    });

    it("assigns sequential ids starting at 0", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);

      await expect(
        vault.connect(poster).createBounty(deadline, METADATA_HASH, { value: AMOUNT })
      )
        .to.emit(vault, "BountyCreated")
        .withArgs(0, poster.address, AMOUNT, deadline, METADATA_HASH);
      await expect(
        vault.connect(poster).createBounty(deadline, METADATA_HASH, { value: AMOUNT })
      )
        .to.emit(vault, "BountyCreated")
        .withArgs(1, poster.address, AMOUNT, deadline, METADATA_HASH);

      expect(await vault.bountyCount()).to.equal(2);
    });

    it("locks msg.value in escrow", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      await createOpenBounty(vault, poster);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        AMOUNT
      );
    });

    it("reverts ZeroAmount when msg.value is 0", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);
      await expect(
        vault.connect(poster).createBounty(deadline, METADATA_HASH, { value: 0 })
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts InvalidDeadline when deadline is not strictly future", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(
        vault.connect(poster).createBounty(now, METADATA_HASH, { value: AMOUNT })
      ).to.be.revertedWithCustomError(vault, "InvalidDeadline");
      await expect(
        vault
          .connect(poster)
          .createBounty(now - ONE_DAY, METADATA_HASH, { value: AMOUNT })
      ).to.be.revertedWithCustomError(vault, "InvalidDeadline");
    });
  });

  describe("submitWork", function () {
    it("records multiple submissions with stable indices and emits WorkSubmitted", async function () {
      const { vault, hunter, hunter2, hunter3, bountyId } = await loadFixture(
        contestedBountyFixture
      );

      expect(await vault.getSubmissionCount(bountyId)).to.equal(3);
      expect(await vault.submissionIndexOf(bountyId, hunter.address)).to.equal(1);
      expect(await vault.submissionIndexOf(bountyId, hunter2.address)).to.equal(2);
      expect(await vault.submissionIndexOf(bountyId, hunter3.address)).to.equal(3);

      const first = await vault.getSubmission(bountyId, 0);
      expect(first.hunter).to.equal(hunter.address);
      expect(first.submissionHash).to.equal(SUBMISSION_A);
      expect(first.submittedAt).to.be.greaterThan(0);
      const second = await vault.getSubmission(bountyId, 1);
      expect(second.hunter).to.equal(hunter2.address);
      expect(second.submissionHash).to.equal(SUBMISSION_B);
    });

    it("a repeat submission overwrites the sender's entry in place (same index)", async function () {
      const { vault, hunter, bountyId } = await loadFixture(contestedBountyFixture);

      const before = await vault.getSubmission(bountyId, 0);
      await time.increase(ONE_DAY / 2);

      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_A2))
        .to.emit(vault, "WorkSubmitted")
        .withArgs(bountyId, 0, hunter.address, SUBMISSION_A2);

      expect(await vault.getSubmissionCount(bountyId)).to.equal(3);
      expect(await vault.submissionIndexOf(bountyId, hunter.address)).to.equal(1);
      const after = await vault.getSubmission(bountyId, 0);
      expect(after.submissionHash).to.equal(SUBMISSION_A2);
      expect(after.submittedAt).to.be.greaterThan(before.submittedAt);
      // Other submissions are untouched.
      const second = await vault.getSubmission(bountyId, 1);
      expect(second.submissionHash).to.equal(SUBMISSION_B);
    });

    it("accepts a submission mined exactly at the deadline (inclusive boundary)", async function () {
      const { vault, hunter, bountyId, deadline } = await loadFixture(
        openBountyFixture
      );
      await time.setNextBlockTimestamp(deadline);
      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_A))
        .to.emit(vault, "WorkSubmitted")
        .withArgs(bountyId, 0, hunter.address, SUBMISSION_A);
    });

    it("reverts DeadlinePassed after the deadline (review window does not extend submission)", async function () {
      const { vault, hunter, bountyId, deadline } = await loadFixture(
        openBountyFixture
      );
      const at = deadline + 1n;
      await time.setNextBlockTimestamp(at);
      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_A))
        .to.be.revertedWithCustomError(vault, "DeadlinePassed")
        .withArgs(deadline, at);
    });

    it("reverts PosterCannotSubmit when the poster submits", async function () {
      const { vault, poster, bountyId } = await loadFixture(openBountyFixture);
      await expect(
        vault.connect(poster).submitWork(bountyId, SUBMISSION_A)
      ).to.be.revertedWithCustomError(vault, "PosterCannotSubmit");
    });

    it("reverts EmptySubmissionHash for bytes32(0)", async function () {
      const { vault, hunter, bountyId } = await loadFixture(openBountyFixture);
      await expect(
        vault.connect(hunter).submitWork(bountyId, ZERO_HASH)
      ).to.be.revertedWithCustomError(vault, "EmptySubmissionHash");
    });

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, hunter } = await loadFixture(openBountyFixture);
      await expect(vault.connect(hunter).submitWork(999, SUBMISSION_A))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });

    it("reverts WrongStatus on Paid and Cancelled bounties", async function () {
      const { vault, poster, hunter, hunter2, bountyId } = await loadFixture(
        contestedBountyFixture
      );
      await vault.connect(poster).selectWinner(bountyId, 0);
      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_A2))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Paid);

      const second = await createOpenBounty(vault, poster);
      await vault.connect(poster).cancelBounty(second.bountyId);
      await expect(vault.connect(hunter2).submitWork(second.bountyId, SUBMISSION_B))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Cancelled);
    });
  });

  describe("selectWinner (manual judging)", function () {
    it("closes the contest early before the deadline once a submission exists", async function () {
      const { vault, poster, hunter2, bountyId, amount } = await loadFixture(
        contestedBountyFixture
      );

      await expect(vault.connect(poster).selectWinner(bountyId, 1))
        .to.emit(vault, "WinnerSelected")
        .withArgs(bountyId, 1, hunter2.address, amount);

      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Paid);
      // Pull payment: credited, not transferred; escrow stays in the contract.
      expect(await vault.pendingWithdrawals(hunter2.address)).to.equal(amount);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        amount
      );
    });

    it("is allowed within the review window after the deadline", async function () {
      const { vault, poster, hunter3, bountyId, deadline, amount } =
        await loadFixture(contestedBountyFixture);
      await time.increaseTo(deadline + BigInt(ONE_DAY));
      await expect(vault.connect(poster).selectWinner(bountyId, 2))
        .to.emit(vault, "WinnerSelected")
        .withArgs(bountyId, 2, hunter3.address, amount);
    });

    it("is allowed at exactly deadline + REVIEW_PERIOD (inclusive window end)", async function () {
      const { vault, poster, hunter, bountyId, deadline, amount } =
        await loadFixture(contestedBountyFixture);
      await time.setNextBlockTimestamp(deadline + BigInt(REVIEW_PERIOD));
      await expect(vault.connect(poster).selectWinner(bountyId, 0))
        .to.emit(vault, "WinnerSelected")
        .withArgs(bountyId, 0, hunter.address, amount);
    });

    it("reverts ReviewPeriodEnded once the window has passed", async function () {
      const { vault, poster, bountyId, deadline } = await loadFixture(
        contestedBountyFixture
      );
      const at = deadline + BigInt(REVIEW_PERIOD) + 1n;
      await time.setNextBlockTimestamp(at);
      await expect(vault.connect(poster).selectWinner(bountyId, 0))
        .to.be.revertedWithCustomError(vault, "ReviewPeriodEnded")
        .withArgs(deadline + BigInt(REVIEW_PERIOD), at);
    });

    it("credits the whole escrow to the winner only (winner-take-all)", async function () {
      const { vault, poster, hunter, hunter2, hunter3, bountyId, amount } =
        await loadFixture(contestedBountyFixture);
      await vault.connect(poster).selectWinner(bountyId, 0);
      expect(await vault.pendingWithdrawals(hunter.address)).to.equal(amount);
      expect(await vault.pendingWithdrawals(hunter2.address)).to.equal(0);
      expect(await vault.pendingWithdrawals(hunter3.address)).to.equal(0);
    });

    it("reverts NotPoster when a non-poster selects", async function () {
      const { vault, hunter, other, bountyId } = await loadFixture(
        contestedBountyFixture
      );
      await expect(vault.connect(hunter).selectWinner(bountyId, 0))
        .to.be.revertedWithCustomError(vault, "NotPoster")
        .withArgs(hunter.address);
      await expect(vault.connect(other).selectWinner(bountyId, 0))
        .to.be.revertedWithCustomError(vault, "NotPoster")
        .withArgs(other.address);
    });

    it("reverts InvalidSubmissionIndex for out-of-range or empty submission lists", async function () {
      const { vault, poster, bountyId } = await loadFixture(contestedBountyFixture);
      await expect(vault.connect(poster).selectWinner(bountyId, 3))
        .to.be.revertedWithCustomError(vault, "InvalidSubmissionIndex")
        .withArgs(bountyId, 3);

      const empty = await createOpenBounty(vault, poster);
      await expect(vault.connect(poster).selectWinner(empty.bountyId, 0))
        .to.be.revertedWithCustomError(vault, "InvalidSubmissionIndex")
        .withArgs(empty.bountyId, 0);
    });

    it("reverts WrongStatus on a repeated select", async function () {
      const { vault, poster, bountyId } = await loadFixture(contestedBountyFixture);
      await vault.connect(poster).selectWinner(bountyId, 0);
      await expect(vault.connect(poster).selectWinner(bountyId, 1))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Paid);
    });

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, poster } = await loadFixture(submittedBountyFixture);
      await expect(vault.connect(poster).selectWinner(999, 0))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });
  });

  describe("settleExpired (optimistic settlement)", function () {
    it("pays the FIRST submission once the window has passed; callable by anyone", async function () {
      const { vault, other, hunter, bountyId, deadline, amount } =
        await loadFixture(contestedBountyFixture);
      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);

      await expect(vault.connect(other).settleExpired(bountyId))
        .to.emit(vault, "BountySettledExpired")
        .withArgs(bountyId, hunter.address, amount);

      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Paid);
      expect(await vault.pendingWithdrawals(hunter.address)).to.equal(amount);
    });

    it("an overwrite keeps the original index, so the revising hunter is still first", async function () {
      const { vault, hunter, other, bountyId, deadline, amount } =
        await loadFixture(contestedBountyFixture);
      await vault.connect(hunter).submitWork(bountyId, SUBMISSION_A2);
      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);

      await expect(vault.connect(other).settleExpired(bountyId))
        .to.emit(vault, "BountySettledExpired")
        .withArgs(bountyId, hunter.address, amount);
    });

    it("reverts ReviewPeriodActive before and exactly at the window end", async function () {
      const { vault, other, bountyId, deadline } = await loadFixture(
        contestedBountyFixture
      );
      const settleAfter = deadline + BigInt(REVIEW_PERIOD);
      await time.setNextBlockTimestamp(settleAfter);
      await expect(vault.connect(other).settleExpired(bountyId))
        .to.be.revertedWithCustomError(vault, "ReviewPeriodActive")
        .withArgs(settleAfter, settleAfter);
    });

    it("reverts NoSubmissions when the window passed with zero submissions", async function () {
      const { vault, other, bountyId, deadline } = await loadFixture(
        openBountyFixture
      );
      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);
      await expect(vault.connect(other).settleExpired(bountyId))
        .to.be.revertedWithCustomError(vault, "NoSubmissions")
        .withArgs(bountyId);
    });

    it("reverts WrongStatus when the bounty is already Paid", async function () {
      const { vault, poster, other, bountyId, deadline } = await loadFixture(
        contestedBountyFixture
      );
      await vault.connect(poster).selectWinner(bountyId, 0);
      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);
      await expect(vault.connect(other).settleExpired(bountyId))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Paid);
    });

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, other } = await loadFixture(submittedBountyFixture);
      await expect(vault.connect(other).settleExpired(999))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });
  });

  describe("cancelBounty", function () {
    it("cancels a zero-submission bounty before the deadline and credits the refund", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );

      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.emit(vault, "BountyCancelled")
        .withArgs(bountyId, amount);

      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Cancelled);
      // Pull refund: credited to the poster, not pushed.
      expect(await vault.pendingWithdrawals(poster.address)).to.equal(amount);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        amount
      );
    });

    it("is allowed after the deadline and after the review window, while zero submissions exist", async function () {
      const { vault, poster, bountyId, deadline, amount } = await loadFixture(
        openBountyFixture
      );
      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.emit(vault, "BountyCancelled")
        .withArgs(bountyId, amount);
    });

    it("reverts HasSubmissions once any submission exists (before and after deadline)", async function () {
      const { vault, poster, bountyId, deadline } = await loadFixture(
        submittedBountyFixture
      );
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "HasSubmissions")
        .withArgs(bountyId);

      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "HasSubmissions")
        .withArgs(bountyId);
    });

    it("reverts NotPoster when a non-poster cancels", async function () {
      const { vault, hunter, other, bountyId } = await loadFixture(
        openBountyFixture
      );
      await expect(vault.connect(hunter).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "NotPoster")
        .withArgs(hunter.address);
      await expect(vault.connect(other).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "NotPoster")
        .withArgs(other.address);
    });

    it("reverts WrongStatus on a repeated cancel", async function () {
      const { vault, poster, bountyId } = await loadFixture(openBountyFixture);
      await vault.connect(poster).cancelBounty(bountyId);
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Cancelled);
    });

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, poster } = await loadFixture(openBountyFixture);
      await expect(vault.connect(poster).cancelBounty(999))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });
  });

  describe("withdraw (pull payments)", function () {
    it("pays the credited prize to the winner and emits Withdrawn", async function () {
      const { vault, poster, hunter, bountyId, amount } = await loadFixture(
        submittedBountyFixture
      );
      await vault.connect(poster).selectWinner(bountyId, 0);

      await expect(vault.connect(hunter).withdraw())
        .to.emit(vault, "Withdrawn")
        .withArgs(hunter.address, amount);
      expect(await vault.pendingWithdrawals(hunter.address)).to.equal(0);
    });

    it("moves exactly the escrowed amount out of the contract", async function () {
      const { vault, poster, hunter, bountyId, amount } = await loadFixture(
        submittedBountyFixture
      );
      await vault.connect(poster).selectWinner(bountyId, 0);
      await expect(
        vault.connect(hunter).withdraw()
      ).to.changeEtherBalances([vault, hunter], [-amount, amount]);
    });

    it("accumulates credits across bounties into a single withdrawal", async function () {
      const { vault, poster, hunter, bountyId, amount } = await loadFixture(
        contestedBountyFixture
      );
      const second = await createOpenBounty(vault, poster);
      await vault.connect(hunter).submitWork(second.bountyId, SUBMISSION_B);

      await vault.connect(poster).selectWinner(bountyId, 0);
      await vault.connect(poster).selectWinner(second.bountyId, 0);

      expect(await vault.pendingWithdrawals(hunter.address)).to.equal(amount * 2n);
      await expect(vault.connect(hunter).withdraw())
        .to.emit(vault, "Withdrawn")
        .withArgs(hunter.address, amount * 2n);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0);
    });

    it("pays the poster's refund through the same path", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );
      await vault.connect(poster).cancelBounty(bountyId);
      await expect(
        vault.connect(poster).withdraw()
      ).to.changeEtherBalances([vault, poster], [-amount, amount]);
    });

    it("reverts NothingToWithdraw when the ledger is empty (and on a second call)", async function () {
      const { vault, poster, hunter, other, bountyId } = await loadFixture(
        submittedBountyFixture
      );
      await expect(vault.connect(other).withdraw())
        .to.be.revertedWithCustomError(vault, "NothingToWithdraw")
        .withArgs(other.address);

      await vault.connect(poster).selectWinner(bountyId, 0);
      await vault.connect(hunter).withdraw();
      await expect(vault.connect(hunter).withdraw())
        .to.be.revertedWithCustomError(vault, "NothingToWithdraw")
        .withArgs(hunter.address);
    });
  });

  describe("adversarial paths", function () {
    it("settlement succeeds when the winner rejects ETH — funds are not locked (v1 R7 fix)", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );
      const RejectingReceiverV2 = await ethers.getContractFactory(
        "RejectingReceiverV2"
      );
      const rejector = await RejectingReceiverV2.deploy();
      const rejectorAddress = await rejector.getAddress();
      await rejector.submitWork(await vault.getAddress(), bountyId, SUBMISSION_A);

      // In v1 this approval reverted forever (TransferFailed) and locked the
      // escrow; in v2 settlement contains no external call, so it just works.
      await expect(vault.connect(poster).selectWinner(bountyId, 0))
        .to.emit(vault, "WinnerSelected")
        .withArgs(bountyId, 0, rejectorAddress, amount);
      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Paid);
      expect(await vault.pendingWithdrawals(rejectorAddress)).to.equal(amount);

      // Only the rejector's own withdrawal fails, by its own choice; the
      // credit is preserved (the failed transfer restores it via revert).
      await expect(rejector.withdraw(await vault.getAddress()))
        .to.be.revertedWithCustomError(vault, "TransferFailed")
        .withArgs(rejectorAddress, amount);
      expect(await vault.pendingWithdrawals(rejectorAddress)).to.equal(amount);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        amount
      );
    });

    it("settleExpired also succeeds when the first submitter rejects ETH", async function () {
      const { vault, other, bountyId, deadline, amount } = await loadFixture(
        openBountyFixture
      );
      const RejectingReceiverV2 = await ethers.getContractFactory(
        "RejectingReceiverV2"
      );
      const rejector = await RejectingReceiverV2.deploy();
      const rejectorAddress = await rejector.getAddress();
      await rejector.submitWork(await vault.getAddress(), bountyId, SUBMISSION_A);

      await time.increaseTo(deadline + BigInt(REVIEW_PERIOD) + 1n);
      await expect(vault.connect(other).settleExpired(bountyId))
        .to.emit(vault, "BountySettledExpired")
        .withArgs(bountyId, rejectorAddress, amount);
      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Paid);
    });

    it("cancel succeeds when the poster rejects ETH (pull refund)", async function () {
      const { vault } = await loadFixture(deployFixture);
      const RejectingReceiverV2 = await ethers.getContractFactory(
        "RejectingReceiverV2"
      );
      const rejector = await RejectingReceiverV2.deploy();
      const rejectorAddress = await rejector.getAddress();
      const deadline = BigInt((await time.latest()) + ONE_DAY);
      await rejector.createBounty(await vault.getAddress(), deadline, METADATA_HASH, {
        value: AMOUNT,
      });

      await expect(rejector.cancelBounty(await vault.getAddress(), 0))
        .to.emit(vault, "BountyCancelled")
        .withArgs(0, AMOUNT);
      expect((await vault.getBounty(0)).status).to.equal(STATUS.Cancelled);
      expect(await vault.pendingWithdrawals(rejectorAddress)).to.equal(AMOUNT);
    });

    it("a stuck payee does not affect other users' withdrawals", async function () {
      const { vault, poster, hunter, bountyId, amount } = await loadFixture(
        openBountyFixture
      );
      const RejectingReceiverV2 = await ethers.getContractFactory(
        "RejectingReceiverV2"
      );
      const rejector = await RejectingReceiverV2.deploy();
      await rejector.submitWork(await vault.getAddress(), bountyId, SUBMISSION_A);
      const second = await createOpenBounty(vault, poster);
      await vault.connect(hunter).submitWork(second.bountyId, SUBMISSION_B);

      await vault.connect(poster).selectWinner(bountyId, 0);
      await vault.connect(poster).selectWinner(second.bountyId, 0);

      await expect(
        vault.connect(hunter).withdraw()
      ).to.changeEtherBalances([vault, hunter], [-amount, amount]);
      // The rejector's credit stays put, contract keeps exactly its share.
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        amount
      );
    });

    it("blocks a reentrant withdraw attempt and pays exactly once", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );
      const ReentrantWithdrawer = await ethers.getContractFactory(
        "ReentrantWithdrawer"
      );
      const attacker = await ReentrantWithdrawer.deploy(await vault.getAddress());
      const attackerAddress = await attacker.getAddress();
      await attacker.submitWork(bountyId, SUBMISSION_A);
      await vault.connect(poster).selectWinner(bountyId, 0);
      await attacker.setAttackEnabled(true);

      // The inner withdraw reenters; the guard blocks it. The outer call pays
      // exactly one credit.
      await expect(attacker.withdraw()).to.changeEtherBalance(
        attackerAddress,
        amount
      );
      expect(await vault.pendingWithdrawals(attackerAddress)).to.equal(0);
      expect(await attacker.lastReentryError()).to.equal(
        REENTRANCY_GUARD_ERROR_SELECTOR
      );

      // Nothing left to steal on a second attempt.
      await attacker.setAttackEnabled(false);
      await expect(attacker.withdraw()).to.be.revertedWithCustomError(
        vault,
        "NothingToWithdraw"
      );
    });
  });

  describe("views", function () {
    it("REVIEW_PERIOD is the 7-day contract constant", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.REVIEW_PERIOD()).to.equal(REVIEW_PERIOD);
    });

    it("getBounty matches the public mapping getter", async function () {
      const { vault, bountyId } = await loadFixture(openBountyFixture);
      const viaGetter = await vault.getBounty(bountyId);
      const viaMapping = await vault.bounties(bountyId);
      expect([...viaGetter]).to.deep.equal([...viaMapping]);
    });

    it("getBounty returns a zeroed struct for an unknown id (mirrors the mapping)", async function () {
      const { vault } = await loadFixture(openBountyFixture);
      const bounty = await vault.getBounty(999);
      expect(bounty.poster).to.equal(ethers.ZeroAddress);
      expect(bounty.amount).to.equal(0);
      expect(bounty.status).to.equal(STATUS.Open);
      expect(bounty.metadataHash).to.equal(ZERO_HASH);
    });

    it("getSubmissionCount returns 0 for an unknown id", async function () {
      const { vault } = await loadFixture(openBountyFixture);
      expect(await vault.getSubmissionCount(999)).to.equal(0);
    });

    it("getSubmission reverts InvalidSubmissionIndex out of range", async function () {
      const { vault, bountyId } = await loadFixture(submittedBountyFixture);
      await expect(vault.getSubmission(bountyId, 1))
        .to.be.revertedWithCustomError(vault, "InvalidSubmissionIndex")
        .withArgs(bountyId, 1);
    });

    it("submissionIndexOf returns 0 for an address that never submitted", async function () {
      const { vault, other, bountyId } = await loadFixture(submittedBountyFixture);
      expect(await vault.submissionIndexOf(bountyId, other.address)).to.equal(0);
    });
  });
});
