const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// enum BountyStatus { Open, Submitted, Paid, Cancelled }
const STATUS = { Open: 0, Submitted: 1, Paid: 2, Cancelled: 3 };

const ONE_DAY = 24 * 60 * 60;
const AMOUNT = ethers.parseEther("1");
const CONTENT = "delivery: https://example.com/result.zip";
const SUBMISSION_HASH = ethers.keccak256(ethers.toUtf8Bytes(CONTENT));
const ZERO_HASH = ethers.ZeroHash;

describe("BountyVault", function () {
  async function deployFixture() {
    const [poster, hunter, other] = await ethers.getSigners();
    const BountyVault = await ethers.getContractFactory("BountyVault");
    const vault = await BountyVault.deploy();
    return { vault, poster, hunter, other };
  }

  async function createOpenBounty(vault, poster, overrides = {}) {
    const deadline =
      overrides.deadline ?? BigInt((await time.latest()) + ONE_DAY);
    const amount = overrides.amount ?? AMOUNT;
    const tx = await vault
      .connect(poster)
      .createBounty(deadline, { value: amount });
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
    return { deadline, amount, bountyId: event.args.bountyId };
  }

  async function openBountyFixture() {
    const base = await deployFixture();
    const bounty = await createOpenBounty(base.vault, base.poster);
    return { ...base, ...bounty };
  }

  async function submittedBountyFixture() {
    const base = await openBountyFixture();
    await base.vault
      .connect(base.hunter)
      .submitWork(base.bountyId, SUBMISSION_HASH);
    return base;
  }

  describe("createBounty (F1, R1)", function () {
    it("stores the bounty and emits BountyCreated", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);

      await expect(vault.connect(poster).createBounty(deadline, { value: AMOUNT }))
        .to.emit(vault, "BountyCreated")
        .withArgs(0, poster.address, AMOUNT, deadline);

      const bounty = await vault.getBounty(0);
      expect(bounty.poster).to.equal(poster.address);
      expect(bounty.hunter).to.equal(ethers.ZeroAddress);
      expect(bounty.amount).to.equal(AMOUNT);
      expect(bounty.deadline).to.equal(deadline);
      expect(bounty.status).to.equal(STATUS.Open);
      expect(bounty.submissionHash).to.equal(ZERO_HASH);
      expect(await vault.bountyCount()).to.equal(1);
    });

    it("assigns sequential ids starting at 0", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);

      await expect(vault.connect(poster).createBounty(deadline, { value: AMOUNT }))
        .to.emit(vault, "BountyCreated")
        .withArgs(0, poster.address, AMOUNT, deadline);
      await expect(vault.connect(poster).createBounty(deadline, { value: AMOUNT }))
        .to.emit(vault, "BountyCreated")
        .withArgs(1, poster.address, AMOUNT, deadline);

      expect(await vault.bountyCount()).to.equal(2);
    });

    it("locks msg.value in escrow", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      await createOpenBounty(vault, poster);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        AMOUNT
      );
    });

    it("reverts ZeroAmount when msg.value is 0 (R1)", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const deadline = BigInt((await time.latest()) + ONE_DAY);
      await expect(
        vault.connect(poster).createBounty(deadline, { value: 0 })
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("reverts InvalidDeadline when deadline is not strictly future (R1)", async function () {
      const { vault, poster } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(
        vault.connect(poster).createBounty(now, { value: AMOUNT })
      ).to.be.revertedWithCustomError(vault, "InvalidDeadline");
      await expect(
        vault.connect(poster).createBounty(now - ONE_DAY, { value: AMOUNT })
      ).to.be.revertedWithCustomError(vault, "InvalidDeadline");
    });
  });

  describe("submitWork (F2, R2, R3)", function () {
    it("records hunter + keccak256(utf8(content)) and emits WorkSubmitted", async function () {
      const { vault, hunter, bountyId } = await loadFixture(openBountyFixture);

      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_HASH))
        .to.emit(vault, "WorkSubmitted")
        .withArgs(bountyId, hunter.address, SUBMISSION_HASH);

      const bounty = await vault.getBounty(bountyId);
      expect(bounty.hunter).to.equal(hunter.address);
      expect(bounty.submissionHash).to.equal(SUBMISSION_HASH);
      expect(bounty.status).to.equal(STATUS.Submitted);
    });

    it("accepts a submission mined exactly at the deadline (R2 inclusive)", async function () {
      const { vault, hunter, bountyId, deadline } = await loadFixture(
        openBountyFixture
      );
      await time.setNextBlockTimestamp(deadline);
      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_HASH))
        .to.emit(vault, "WorkSubmitted")
        .withArgs(bountyId, hunter.address, SUBMISSION_HASH);
    });

    it("reverts DeadlinePassed after the deadline (R2)", async function () {
      const { vault, hunter, bountyId, deadline } = await loadFixture(
        openBountyFixture
      );
      const at = deadline + 1n;
      await time.setNextBlockTimestamp(at);
      await expect(vault.connect(hunter).submitWork(bountyId, SUBMISSION_HASH))
        .to.be.revertedWithCustomError(vault, "DeadlinePassed")
        .withArgs(deadline, at);
    });

    it("reverts WrongStatus on a second submission (R3)", async function () {
      const { vault, hunter, other, bountyId } = await loadFixture(
        submittedBountyFixture
      );
      await expect(
        vault.connect(other).submitWork(bountyId, SUBMISSION_HASH)
      )
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Submitted);
      // Even the original hunter cannot submit twice.
      await expect(
        vault.connect(hunter).submitWork(bountyId, SUBMISSION_HASH)
      ).to.be.revertedWithCustomError(vault, "WrongStatus");
    });

    it("reverts WrongStatus on Paid and Cancelled bounties", async function () {
      const { vault, poster, hunter, other, bountyId } = await loadFixture(
        submittedBountyFixture
      );
      await vault.connect(poster).approveSubmission(bountyId);
      await expect(vault.connect(other).submitWork(bountyId, SUBMISSION_HASH))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Paid);

      const second = await createOpenBounty(vault, poster);
      await vault.connect(poster).cancelBounty(second.bountyId);
      await expect(
        vault.connect(hunter).submitWork(second.bountyId, SUBMISSION_HASH)
      )
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Cancelled);
    });

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, hunter } = await loadFixture(openBountyFixture);
      await expect(vault.connect(hunter).submitWork(999, SUBMISSION_HASH))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });

    it("reverts PosterCannotSubmit when the poster submits", async function () {
      const { vault, poster, bountyId } = await loadFixture(openBountyFixture);
      await expect(
        vault.connect(poster).submitWork(bountyId, SUBMISSION_HASH)
      ).to.be.revertedWithCustomError(vault, "PosterCannotSubmit");
    });

    it("reverts EmptySubmissionHash for bytes32(0)", async function () {
      const { vault, hunter, bountyId } = await loadFixture(openBountyFixture);
      await expect(
        vault.connect(hunter).submitWork(bountyId, ZERO_HASH)
      ).to.be.revertedWithCustomError(vault, "EmptySubmissionHash");
    });
  });

  describe("approveSubmission (F3, R4, R6, R7, R8)", function () {
    it("pays the full escrow to the hunter and emits BountyPaid (R8: no fee)", async function () {
      const { vault, poster, hunter, bountyId, amount } = await loadFixture(
        submittedBountyFixture
      );

      await expect(vault.connect(poster).approveSubmission(bountyId))
        .to.emit(vault, "BountyPaid")
        .withArgs(bountyId, hunter.address, amount);

      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Paid);
    });

    it("moves exactly the escrowed amount out of the contract", async function () {
      const { vault, poster, hunter, bountyId, amount } = await loadFixture(
        submittedBountyFixture
      );
      await expect(
        vault.connect(poster).approveSubmission(bountyId)
      ).to.changeEtherBalances([vault, hunter], [-amount, amount]);
    });

    it("is allowed after the deadline (R4: deadline gates submission, not settlement)", async function () {
      const { vault, poster, hunter, bountyId, deadline, amount } =
        await loadFixture(submittedBountyFixture);
      await time.increaseTo(deadline + BigInt(ONE_DAY));
      await expect(vault.connect(poster).approveSubmission(bountyId))
        .to.emit(vault, "BountyPaid")
        .withArgs(bountyId, hunter.address, amount);
    });

    it("reverts WrongStatus on a repeated approve", async function () {
      const { vault, poster, bountyId } = await loadFixture(
        submittedBountyFixture
      );
      await vault.connect(poster).approveSubmission(bountyId);
      await expect(vault.connect(poster).approveSubmission(bountyId))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Submitted, STATUS.Paid);
    });

    it("reverts WrongStatus when approving before any submission", async function () {
      const { vault, poster, bountyId } = await loadFixture(openBountyFixture);
      await expect(vault.connect(poster).approveSubmission(bountyId))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Submitted, STATUS.Open);
    });

    it("reverts NotPoster when a non-poster approves", async function () {
      const { vault, hunter, other, bountyId } = await loadFixture(
        submittedBountyFixture
      );
      await expect(vault.connect(hunter).approveSubmission(bountyId))
        .to.be.revertedWithCustomError(vault, "NotPoster")
        .withArgs(hunter.address);
      await expect(vault.connect(other).approveSubmission(bountyId))
        .to.be.revertedWithCustomError(vault, "NotPoster")
        .withArgs(other.address);
    });

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, poster } = await loadFixture(submittedBountyFixture);
      await expect(vault.connect(poster).approveSubmission(999))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });

    it("reverts TransferFailed and keeps Submitted when the hunter rejects ETH (R7)", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );
      const RejectingReceiver = await ethers.getContractFactory(
        "RejectingReceiver"
      );
      const rejector = await RejectingReceiver.deploy();
      await rejector.submitWork(await vault.getAddress(), bountyId, SUBMISSION_HASH);

      await expect(vault.connect(poster).approveSubmission(bountyId))
        .to.be.revertedWithCustomError(vault, "TransferFailed")
        .withArgs(await rejector.getAddress(), amount);

      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Submitted);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(
        amount
      );
    });
  });

  describe("cancelBounty (F4, R5, R7, R8)", function () {
    it("refunds the full escrow to the poster and emits BountyCancelled", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );

      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.emit(vault, "BountyCancelled")
        .withArgs(bountyId, amount);

      expect((await vault.getBounty(bountyId)).status).to.equal(STATUS.Cancelled);
    });

    it("moves exactly the escrowed amount back to the poster (R8: no fee)", async function () {
      const { vault, poster, bountyId, amount } = await loadFixture(
        openBountyFixture
      );
      await expect(
        vault.connect(poster).cancelBounty(bountyId)
      ).to.changeEtherBalances([vault, poster], [-amount, amount]);
    });

    it("is allowed after the deadline while no submission exists (R5)", async function () {
      const { vault, poster, bountyId, deadline, amount } = await loadFixture(
        openBountyFixture
      );
      await time.increaseTo(deadline + BigInt(ONE_DAY));
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.emit(vault, "BountyCancelled")
        .withArgs(bountyId, amount);
    });

    it("reverts WrongStatus once a submission exists (R5)", async function () {
      const { vault, poster, bountyId } = await loadFixture(
        submittedBountyFixture
      );
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Submitted);
    });

    it("reverts WrongStatus on a repeated cancel", async function () {
      const { vault, poster, bountyId } = await loadFixture(openBountyFixture);
      await vault.connect(poster).cancelBounty(bountyId);
      await expect(vault.connect(poster).cancelBounty(bountyId))
        .to.be.revertedWithCustomError(vault, "WrongStatus")
        .withArgs(STATUS.Open, STATUS.Cancelled);
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

    it("reverts BountyNotFound for an unknown id", async function () {
      const { vault, poster } = await loadFixture(openBountyFixture);
      await expect(vault.connect(poster).cancelBounty(999))
        .to.be.revertedWithCustomError(vault, "BountyNotFound")
        .withArgs(999);
    });

    it("reverts TransferFailed and stays Open when the poster rejects ETH (R7)", async function () {
      const { vault } = await loadFixture(deployFixture);
      const RejectingReceiver = await ethers.getContractFactory(
        "RejectingReceiver"
      );
      const rejector = await RejectingReceiver.deploy();
      const deadline = BigInt((await time.latest()) + ONE_DAY);
      await rejector.createBounty(await vault.getAddress(), deadline, {
        value: AMOUNT,
      });

      await expect(rejector.cancelBounty(await vault.getAddress(), 0))
        .to.be.revertedWithCustomError(vault, "TransferFailed")
        .withArgs(await rejector.getAddress(), AMOUNT);

      expect((await vault.getBounty(0)).status).to.equal(STATUS.Open);
    });
  });

  describe("views", function () {
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
    });
  });
});
