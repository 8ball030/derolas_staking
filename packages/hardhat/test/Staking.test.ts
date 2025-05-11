import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("DerolasStaking", function () {
  let staking: Contract;
  let incentiveToken: Contract;
  let balancerRouter: Contract;
  let stakingInstance: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const MIN_DONATION = ethers.parseEther("0.1");
  const EPOCH_LENGTH = 7 * 24 * 60 * 60; // 7 days
  const MAX_CHECKPOINT_DELAY = 24 * 60 * 60; // 1 day
  const AVAILABLE_REWARDS = ethers.parseEther("1000");
  const ASSETS_IN_POOL = 2;
  const INCENTIVE_TOKEN_INDEX = 1;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock incentive token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    incentiveToken = await MockERC20.deploy("Incentive Token", "INC");
    await incentiveToken.waitForDeployment();

    // Deploy mock balancer router
    const MockBalancerRouter = await ethers.getContractFactory("MockBalancerRouter");
    balancerRouter = await MockBalancerRouter.deploy();
    await balancerRouter.waitForDeployment();

    // Deploy mock staking instance
    const MockStakingInstance = await ethers.getContractFactory("MockStakingInstance");
    stakingInstance = await MockStakingInstance.deploy();
    await stakingInstance.waitForDeployment();

    // Deploy staking contract
    const DerolasStaking = await ethers.getContractFactory("DerolasStaking");
    staking = await DerolasStaking.deploy(
      MIN_DONATION,
      balancerRouter.address,
      ethers.ZeroAddress, // poolId
      ASSETS_IN_POOL,
      incentiveToken.address,
      INCENTIVE_TOKEN_INDEX,
      AVAILABLE_REWARDS,
      EPOCH_LENGTH,
      MAX_CHECKPOINT_DELAY,
    );
    await staking.waitForDeployment();

    // Set staking instance
    await staking.setStakingInstance(stakingInstance.address);

    // Mint incentive tokens to the staking contract
    await incentiveToken.mint(staking.address, AVAILABLE_REWARDS);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await staking.owner()).to.equal(owner.address);
    });

    it("Should initialize with correct parameters", async function () {
      expect(await staking.currentEpoch()).to.equal(1);
      expect(await staking.assetsInPool()).to.equal(ASSETS_IN_POOL);
      expect(await staking.incentiveTokenAddress()).to.equal(incentiveToken.address);
    });
  });

  describe("Donations", function () {
    it("Should accept valid donations", async function () {
      const donationAmount = ethers.parseEther("1");
      await staking.connect(user1).donate({ value: donationAmount });

      expect(await staking.epochToDonations(1, user1.address)).to.equal(donationAmount);
    });

    it("Should reject donations below minimum", async function () {
      const smallDonation = ethers.parseEther("0.01");
      await expect(staking.connect(user1).donate({ value: smallDonation })).to.be.revertedWith(
        "Donation amount is less than the minimum donation",
      );
    });

    it("Should prevent multiple donations in same epoch", async function () {
      const donationAmount = ethers.parseEther("1");
      await staking.connect(user1).donate({ value: donationAmount });

      await expect(staking.connect(user1).donate({ value: donationAmount })).to.be.revertedWith(
        "Already donated this epoch",
      );
    });
  });

  describe("Reward Claiming", function () {
    beforeEach(async function () {
      // Setup donations
      await staking.connect(user1).donate({ value: ethers.parseEther("1") });
      await staking.connect(user2).donate({ value: ethers.parseEther("2") });

      // End epoch
      await time.increase(EPOCH_LENGTH + 1);
      await staking.endEpoch();
    });

    it("Should allow users to claim rewards", async function () {
      const initialBalance = await incentiveToken.balanceOf(user1.address);
      await staking.connect(user1).claim();
      const finalBalance = await incentiveToken.balanceOf(user1.address);

      expect(finalBalance.sub(initialBalance)).to.be.gt(0);
    });

    it("Should prevent double claiming", async function () {
      await staking.connect(user1).claim();
      await expect(staking.connect(user1).claim()).to.be.revertedWith("Already claimed");
    });
  });

  describe("Epoch Management", function () {
    it("Should end epoch after epoch length", async function () {
      await staking.connect(user1).donate({ value: ethers.parseEther("1") });
      await time.increase(EPOCH_LENGTH + 1);

      await staking.endEpoch();
      expect(await staking.currentEpoch()).to.equal(2);
    });

    it("Should prevent ending epoch before time", async function () {
      await expect(staking.endEpoch()).to.be.revertedWith("Epoch not over");
    });
  });

  describe("Parameter Updates", function () {
    it("Should allow owner to update parameters", async function () {
      const newRewards = ethers.parseEther("2000");
      const newLength = EPOCH_LENGTH * 2;
      const newMaxDelay = MAX_CHECKPOINT_DELAY * 2;
      const newMinDonation = MIN_DONATION.mul(2);

      await staking.changeParams(newRewards, newLength, newMaxDelay, newMinDonation);

      // End current epoch to apply new parameters
      await time.increase(EPOCH_LENGTH + 1);
      await staking.endEpoch();

      // Check if parameters were updated
      const epoch2 = await staking.epochPoints(2);
      expect(epoch2.availableRewards).to.equal(newRewards);
      expect(epoch2.length).to.equal(newLength);
      expect(epoch2.maxCheckpointDelay).to.equal(newMaxDelay);
      expect(epoch2.minDonations).to.equal(newMinDonation);
    });

    it("Should prevent non-owner from updating parameters", async function () {
      await expect(
        staking.connect(user1).changeParams(AVAILABLE_REWARDS, EPOCH_LENGTH, MAX_CHECKPOINT_DELAY, MIN_DONATION),
      ).to.be.revertedWith("Unauthorized account");
    });
  });

  describe("Owner Management", function () {
    it("Should allow owner to transfer ownership", async function () {
      await staking.changeOwner(user1.address);
      expect(await staking.owner()).to.equal(user1.address);
    });

    it("Should prevent non-owner from changing ownership", async function () {
      await expect(staking.connect(user1).changeOwner(user2.address)).to.be.revertedWith("Unauthorized account");
    });

    it("Should prevent setting zero address as owner", async function () {
      await expect(staking.changeOwner(ethers.ZeroAddress)).to.be.revertedWith("Zero address");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await staking.connect(user1).donate({ value: ethers.parseEther("1") });
      await staking.connect(user2).donate({ value: ethers.parseEther("2") });
    });

    it("Should return correct claimable amount", async function () {
      const claimable = await staking.claimable(user1.address);
      expect(claimable).to.be.gt(0);
    });

    it("Should return correct ticket percentage", async function () {
      const percentage = await staking.estimateTicketPercentage(ethers.parseEther("1"));
      expect(percentage).to.be.gt(0);
    });

    it("Should return correct current share", async function () {
      const share = await staking.getCurrentShare(user1.address);
      expect(share).to.be.gt(0);
    });

    it("Should return correct epoch progress", async function () {
      const progress = await staking.getEpochProgress();
      expect(progress).to.be.gt(0);
    });
  });

  describe("Incentive Balance Management", function () {
    it("Should allow topping up incentive balance", async function () {
      const topUpAmount = ethers.parseEther("100");
      await incentiveToken.mint(user1.address, topUpAmount);
      await incentiveToken.connect(user1).approve(staking.address, topUpAmount);

      await staking.connect(user1).topUpIncentiveBalance(topUpAmount);
      expect(await incentiveToken.balanceOf(staking.address)).to.equal(AVAILABLE_REWARDS.add(topUpAmount));
    });

    it("Should prevent topping up with zero amount", async function () {
      await expect(staking.connect(user1).topUpIncentiveBalance(0)).to.be.revertedWith("Amount must be greater than 0");
    });
  });
});
