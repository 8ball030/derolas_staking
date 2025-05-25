import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DerolasStaking } from "../typechain-types";
// import { Contract } from "ethers/lib.commonjs/ethers";

// const minimumDonation: number = 1000000000000000; // 0.001 ETH
// const balancerRouter: string = "0x3f170631ed9821Ca51A59D996aB095162438DC10";
// const poolId: string = "0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c";
// const assetsInPool: number = 8;
// const wethIndex: number = 1;
// const olasIndex: number = 3;
// const incentiveTokenAddress: string = "0x54330d28ca3357f294334bdc454a032e7f353416";

const INCENTIVE_TOKENS = ethers.parseEther("1000");
const OLAS_HOLDER = "0x7Da5c3878497bA7dC9E3F3fd6735e3F26A110b2a"; // Replace with the actual OLAS holder address
const minimumDonation: number = 1000000000000000; // 0.001 ETH
const balancerRouter: string = "0x3f170631ed9821ca51a59d996ab095162438dc10";
const poolId: string = "0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c";
const assetsInPool: number = 8;
const wethIndex: number = 1;
const olasIndex: number = 3;
const incentiveTokenAddress: string = "0x54330d28ca3357f294334bdc454a032e7f353416";

const epochLength: number = 90; // 90 seconds
const maxCheckpointDelay: number = 30; // 30 seconds
const availableRewards: number = 800000000; // 0.8 OLAS tokens

async function impersonateAccount(stakingContract: DerolasStaking) {
  // Impersonate OLAS holder
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [OLAS_HOLDER],
  });
  const impersonatedSigner = await ethers.getSigner(OLAS_HOLDER);
  // Fund the impersonated account
  const [deployer] = await ethers.getSigners();
  await deployer.sendTransaction({
    to: OLAS_HOLDER,
    value: ethers.parseEther("1"),
  });

  // Transfer OLAS to your staking contract
  const olasToken = await ethers.getContractAt("IERC20", incentiveTokenAddress);
  await olasToken.connect(impersonatedSigner).transfer(stakingContract.target, INCENTIVE_TOKENS);
  return INCENTIVE_TOKENS;
}

describe("DerolasStaking", function () {
  // We define a fixture to reuse the same setup in every test.

  let stakingContract: DerolasStaking;
  before(async () => {
    // const [owner] = await ethers.getSigners();
    const yourContractFactory = await ethers.getContractFactory("DerolasStaking");
    stakingContract = (await yourContractFactory.deploy(
      minimumDonation,
      balancerRouter,
      poolId,
      assetsInPool,

      incentiveTokenAddress,
      olasIndex,
      wethIndex,
      availableRewards,
      epochLength,
      maxCheckpointDelay,
    )) as DerolasStaking;
    await stakingContract.waitForDeployment();

    // const MockStakingInstance = await ethers.getContractFactory("MockStakingInstance");

    // // const stakingInstance = (await MockStakingInstance.deploy(
    // // )) as Contract;
    // // stakingContract = stakingInstance as DerolasStaking;

    // await stakingInstance.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have no without balance for game", async function () {
      expect(await stakingContract.incentiveBalance()).to.equal(0);
    });

    it("Should revert for estimating ticket share", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const result = stakingContract.estimateTicketPercentage(donationAmountInWei);
      // we expect to throw as we cannot play the game yet
      await expect(result).to.be.revertedWith("Not enough rewards to play the game");
    });
    it("Should revert for donate", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const donate = stakingContract.donate({ value: donationAmountInWei });
      // we expect to throw as we cannot play the game yet
      await expect(donate).to.be.revertedWith("Not enough rewards to play the game");
    });
    it("Should have the correct minimum donation", async function () {
      expect(await stakingContract.minimumDonation()).to.equal(minimumDonation);
    });
    it("Should have the correct balancer router", async function () {
      expect((await stakingContract.balancerRouter()).toLowerCase()).to.equal(balancerRouter);
    });
    it("Should start with epoch 1", async function () {
      expect(await stakingContract.currentEpoch()).to.equal(1);
    });
    it("Should start with no OLAS rewards", async function () {
      expect(await stakingContract.incentiveBalance()).to.equal(0);
    });

    it("Should revert when the value is not enough", async function () {
      const donationAmount = 0.0001; // 0.0001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      await expect(stakingContract.donate({ value: donationAmountInWei })).to.be.revertedWith(
        "Donation amount is less than the minimum donation",
      );
    });

    it("Should revert for mismatching values", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const donate = stakingContract.donate({ value: donationAmountInWei });
      // we expect to throw as we cannot play the game yet
      await expect(donate).to.be.revertedWith("Not enough rewards to play the game");
    });
    it("Should start with no OLAS rewards", async function () {
      expect(await stakingContract.incentiveBalance()).to.equal(0);
    });
  });

  describe("Funding", function () {
    it("Should start with OLAS rewards", async function () {
      expect(await stakingContract.incentiveBalance()).to.equal(0);
    });

    it("Should top up OLAS rewards via impersonation", async function () {
      const transferAmount = await impersonateAccount(stakingContract);
      expect(await stakingContract.incentiveBalance()).to.equal(transferAmount);
    });

    // Impersonate OLAS holder

    it("Should let Users donate", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const result = await stakingContract.donate({ value: donationAmountInWei });
      expect(result).to.be.not.revertedWith("Not enough rewards to play the game");
      const incentiveBalance = await stakingContract.incentiveBalance();
      expect(incentiveBalance).to.equal(INCENTIVE_TOKENS);
    });
  });
  describe("DonationShares", function () {
    it("Should start with OLAS rewards", async function () {
      expect(await stakingContract.incentiveBalance()).to.equal(INCENTIVE_TOKENS);
    });
    it("Should let give all shares to single donator", async function () {
      // const transferAmount = await impersonateAccount(stakingContract);
      // expect(await stakingContract.incentiveBalance()).to.equal(transferAmount);

      const [deployer] = await ethers.getSigners();

      // create and fund a new wallet
      const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
      await deployer.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("1.0"), // fund the wallet
      });

      const initialShares = await stakingContract.getCurrentShare(wallet.address);

      // current initial shares should be 0
      expect(initialShares).to.equal(0);
      // donate to the contract
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      await stakingContract.connect(wallet).donate({ value: donationAmountInWei });
      const newShares = await stakingContract.getCurrentShare(wallet.address);
      // check the shares
      expect(newShares).to.be.gt(initialShares);
    });

    it("Should let give shares to multiple donators", async function () {
      // const transferAmount = await impersonateAccount(stakingContract);
      // expect(await stakingContract.incentiveBalance()).to.equal(transferAmount);

      const [deployer] = await ethers.getSigners();

      // create and fund a new wallet
      const wallet1 = ethers.Wallet.createRandom().connect(ethers.provider);
      await deployer.sendTransaction({
        to: wallet1.address,
        value: ethers.parseEther("1.0"), // fund the wallet
      });

      const initialShares = await stakingContract.getCurrentShare(wallet1.address);

      // current initial shares should be 0
      expect(initialShares).to.equal(0);
      // donate to the contract
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      await stakingContract.connect(wallet1).donate({ value: donationAmountInWei });
      const newShares = await stakingContract.getCurrentShare(wallet1.address);
      // check the shares
      expect(newShares).to.be.gt(initialShares);
    });
  });

  describe("GameFlow", function () {
    it("Contract starts at 1 epoch.", async function () {
      // const transferAmount = await impersonateAccount(stakingContract);
      // expect(await stakingContract.incentiveBalance()).to.equal(transferAmount);
      const currentEpoch = await stakingContract.currentEpoch();
      expect(currentEpoch).to.equal(1);
    });
    it("Can end Epoch and start a new epoch.", async function () {
      const currentEpoch = await stakingContract.currentEpoch();
      const blockRemaining = await stakingContract.getBlocksRemaining();
      for (let i = 0; i < Number(blockRemaining); i++) {
        await network.provider.send("evm_mine");
      }
      await stakingContract.endEpoch();
      const newEpoch = await stakingContract.currentEpoch();
      expect(newEpoch).to.gt(currentEpoch);
    });
    it("Should be able to contribute in the first epoch", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      await expect(stakingContract.donate({ value: donationAmountInWei })).to.be.not.revertedWith(
        "Game has not started yet",
      );
    });
    it("Cannot end epoch if not enough time has passed", async function () {
      const blockRemaining = await stakingContract.getBlocksRemaining();
      expect(blockRemaining).to.be.gt(0);
      const currentEpoch = await stakingContract.currentEpoch();
      await expect(stakingContract.endEpoch()).to.be.revertedWith("Epoch not over");
      const postEpoch = await stakingContract.currentEpoch();
      expect(postEpoch).to.equal(currentEpoch);
    });
    it("Can end Epoch and start a new epoch.", async function () {
      const currentEpoch = await stakingContract.currentEpoch();
      const blockRemaining = await stakingContract.getBlocksRemaining();
      for (let i = 0; i < Number(blockRemaining); i++) {
        await network.provider.send("evm_mine");
      }
      await stakingContract.endEpoch();
      const newEpoch = await stakingContract.currentEpoch();
      expect(newEpoch).to.gt(currentEpoch);
    });
    it("Should show contributors claimable", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const result = await stakingContract.donate({ value: donationAmountInWei });
      expect(result).to.be.not.revertedWith("Not enough rewards to play the game");
      // we now have a donation, we can end the epoch
      const currentEpoch = await stakingContract.currentEpoch();
      const [deployer] = await ethers.getSigners();
      const claimable = await stakingContract.claimable(deployer.address);

      const blockRemaining = await stakingContract.getBlocksRemaining();
      // we need to wait for the block remaining to be 0
      for (let i = 0; i < Number(blockRemaining); i++) {
        await network.provider.send("evm_mine");
      }
      // mine the block expecting claimable from the previous epoch
      await stakingContract.endEpoch();
      const newEpoch = await stakingContract.currentEpoch();
      expect(newEpoch).to.be.eq(currentEpoch + BigInt(1));
      const claimable2 = await stakingContract.claimable(deployer.address);
      expect(claimable2).to.be.gt(claimable);
    });
    it("Should allow claim", async function () {
      const [deployer] = await ethers.getSigners();
      const olasToken = await ethers.getContractAt("IERC20", incentiveTokenAddress);
      const preClaimBalanceIncentive = await olasToken.balanceOf(deployer.address);
      const stakingContractBalance = await olasToken.balanceOf(stakingContract.target);
      const result = await stakingContract.claim();
      const postClaimBalanceIncentive = await olasToken.balanceOf(deployer.address);
      const postStakingContractBalance = await olasToken.balanceOf(stakingContract.target);
      // check that the balance of the deployer has increased
      expect(postClaimBalanceIncentive).to.be.gt(preClaimBalanceIncentive);
      // check that the balance of the staking contract has decreased
      expect(postStakingContractBalance).to.be.lt(stakingContractBalance);

      expect(result).to.be.not.revertedWith("Not enough rewards to play the game");
    });
    it("Users should then not have claimable", async function () {
      const [deployer] = await ethers.getSigners();
      const claimable = await stakingContract.claimable(deployer.address);
      console.log("Claimable after claim: ", claimable.toString());
      expect(claimable).to.be.equal(0);
    });

    it("Should donate unclaimed", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const result = await stakingContract.donate({ value: donationAmountInWei });
      expect(result).to.be.not.revertedWith("Not enough rewards to play the game");
      // we now have a donation, we can end the epoch
      const currentEpoch = await stakingContract.currentEpoch();

      let blockRemaining = await stakingContract.getBlocksRemaining();
      // we need to wait for the block remaining to be 0
      for (let i = 0; i < Number(blockRemaining); i++) {
        await network.provider.send("evm_mine");
      }
      // mine the block
      await stakingContract.endEpoch();
      const newEpoch = await stakingContract.currentEpoch();
      expect(newEpoch).to.be.eq(currentEpoch + BigInt(1));

      // end another epoch
      blockRemaining = await stakingContract.getBlocksRemaining();
      // we need to wait for the block remaining to be 0
      // verify 2 epochs have passed
      const newEpoch2 = await stakingContract.currentEpoch();
      expect(newEpoch2).to.be.eq(currentEpoch + BigInt(1));

      for (let i = 0; i < Number(blockRemaining); i++) {
        await network.provider.send("evm_mine");
      }
      // mine the block
      await stakingContract.endEpoch();

      // check total unclaimed which should be now be nothing as all unclaimed should be donated
      // const totalUnclaimed2 = await stakingContract.getTotalUnclaimed();
      // console.log("Total unclaimed after 2 epochs: ", totalUnclaimed2.toString());
      // expect(totalUnclaimed2).to.be.eq(0);
    });

    // confirm we can call the topUp function
    it("Should top up OLAS rewards via function", async function () {
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [OLAS_HOLDER],
      });
      const impersonatedSigner = await ethers.getSigner(OLAS_HOLDER);
      // Fund the impersonated account
      const [deployer] = await ethers.getSigners();
      await deployer.sendTransaction({
        to: OLAS_HOLDER,
        value: ethers.parseEther("1"),
      });

      // Transfer OLAS to your staking contract
      const olasToken = await ethers.getContractAt("IERC20", incentiveTokenAddress);
      await olasToken.connect(impersonatedSigner).approve(stakingContract.target, INCENTIVE_TOKENS);
      const initialBalance = await stakingContract.incentiveBalance();
      await stakingContract.connect(impersonatedSigner).topUpIncentiveBalance(INCENTIVE_TOKENS);
      const newBalance = await stakingContract.incentiveBalance();
      expect(newBalance).to.greaterThan(initialBalance);
    });
  });
});
