import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DerolasStaking } from "../typechain-types";

const minimumDonation: number = 1000000000000000; // 0.001 ETH
const balancerRouter: string = "0x3f170631ed9821Ca51A59D996aB095162438DC10";
const poolId: string = "0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c";
const assetsInPool: number = 8;
const wethIndex: number = 1;
const olasIndex: number = 4;
const incentiveTokenAddress: string = "0x54330d28ca3357f294334bdc454a032e7f353416";

const INCENTIVE_TOKENS = ethers.parseEther("1000");
const OLAS_HOLDER = "0x7Da5c3878497bA7dC9E3F3fd6735e3F26A110b2a"; // Replace with the actual OLAS holder address

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
    const [owner] = await ethers.getSigners();
    const yourContractFactory = await ethers.getContractFactory("DerolasStaking");
    stakingContract = (await yourContractFactory.deploy(
      owner.address,
      minimumDonation,
      balancerRouter,
      poolId,
      assetsInPool,
      wethIndex,
      olasIndex,
      incentiveTokenAddress,
    )) as DerolasStaking;
    await stakingContract.waitForDeployment();
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
      await expect(result).to.be.revertedWith("Not enough OLAS rewards to play the game");
    });
    it("Should revert for donate", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const donate = stakingContract.donate({ value: donationAmountInWei });
      // we expect to throw as we cannot play the game yet
      await expect(donate).to.be.revertedWith("Not enough OLAS rewards to play the game");
    });
    it("Should have the correct minimum donation", async function () {
      expect(await stakingContract.minimumDonation()).to.equal(minimumDonation);
    });
    it("Should have the correct balancer router", async function () {
      expect(await stakingContract.balancerRouter()).to.equal(balancerRouter);
    });
    it("Should start with epoch 0", async function () {
      expect(await stakingContract.currentEpoch()).to.equal(0);
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
      await expect(donate).to.be.revertedWith("Not enough OLAS rewards to play the game");
    });
    it("Should start with epoch 0", async function () {
      expect(await stakingContract.currentEpoch()).to.equal(0);
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
      expect(result).to.be.not.revertedWith("Not enough OLAS rewards to play the game");
      const incentiveBalance = await stakingContract.incentiveBalance();
      expect(incentiveBalance).to.equal(INCENTIVE_TOKENS);
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
    });
  });

  describe("Claiming", function () {
    it("A donar can claim.", async function () {
      // const transferAmount = await impersonateAccount(stakingContract);
      // expect(await stakingContract.incentiveBalance()).to.equal(transferAmount);

      const incentiveContract = await ethers.getContractAt("IERC20", incentiveTokenAddress);
      const [deployer] = await ethers.getSigners();
      // we fastforward the time to the next epoch
      await network.provider.send("evm_increaseTime", [86400]); // 1 day
      await network.provider.send("evm_mine");
      // donate to the contract
      // check the incentive balance
      const initialBalance = await incentiveContract.balanceOf(deployer.address);
      expect(await stakingContract.incentiveBalance()).to.equal(INCENTIVE_TOKENS);
      // check the epoch
      const currentEpoch = await stakingContract.currentEpoch();
      expect(currentEpoch).to.equal(0);
      // End the epoch
      stakingContract.claim().then(() => {});
      await stakingContract.endEpoch();
      // check the epoch
      const newEpoch = await stakingContract.currentEpoch();
      expect(newEpoch).to.equal(1);

      // Confirm we still have the same balance
      const newBalance = await incentiveContract.balanceOf(deployer.address);
      expect(newBalance).to.be.equal(initialBalance);
      // we now should be able to claim

      const newBalanceAfterClaim = await incentiveContract.balanceOf(deployer.address);
      // check the shares
      // we now should be able to claim for this epoch
      await stakingContract.claimable(deployer.address).then(claimable => {
        expect(claimable).to.be.gt(0);
      });
      expect(newBalanceAfterClaim).to.be.gt(newBalance);
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
      // expect(await stakingContract.topUpIncentiveBalance(minimumDonation)).to.be.not.revertedWith(
      //   "Not enough OLAS rewards to play the game",
      // );
    });
  });
});
