import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DerolasAuction } from "../typechain-types";

const minimumDonation: number = 1000000000000000; // 0.001 ETH
const balancerRouter: string = "0x3f170631ed9821Ca51A59D996aB095162438DC10";

const balancerVaultAdmin: string = "0x35fFB749B273bEb20F40f35EdeB805012C539864";

const poolId: string = "0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c";
const assetsInPool: number = 8;
const wethIndex: number = 1;
const olasIndex: number = 3;
const incentiveTokenAddress: string = "0x54330d28ca3357f294334bdc454a032e7f353416";

const INCENTIVE_TOKENS = ethers.parseEther("1000");
const OLAS_HOLDER = "0x7Da5c3878497bA7dC9E3F3fd6735e3F26A110b2a"; // Replace with the actual OLAS holder address

async function impersonateAccount(stakingContract: DerolasAuction) {
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

describe("DerolasAuction", function () {
  // We define a fixture to reuse the same setup in every test.

  let stakingContract: DerolasAuction;
  before(async () => {
    const [owner] = await ethers.getSigners();
    const yourContractFactory = await ethers.getContractFactory("DerolasAuction");
    stakingContract = (await yourContractFactory.deploy(
      owner.address,
      minimumDonation,
      balancerRouter,
      balancerVaultAdmin,
      poolId,
      assetsInPool,
      wethIndex,
      olasIndex,
      incentiveTokenAddress,
    )) as DerolasAuction;
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
      await expect(donate).to.be.revertedWith("Not enough OLAS rewards to play the game");
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
  });
  describe("DonationShares", function () {
    it("Should start with OLAS rewards", async function () {
      expect(await stakingContract.incentiveBalance()).to.equal(INCENTIVE_TOKENS);
    });
    it("Should let give all shares to single donator", async function () {
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

    it("Should allow the gamestate to be retrieved", async function () {
      const [deployer] = await ethers.getSigners();
      const gameState = await stakingContract.getGameState(deployer.address);
      expect(gameState).to.be.not.revertedWith("Game has not started yet");
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
      expect(result).to.be.not.revertedWith("Not enough OLAS rewards to play the game");
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
      expect(claimable2).to.be.eq(claimable);
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

      expect(result).to.be.not.revertedWith("Not enough OLAS rewards to play the game");
    });
    it("Users should then not have claimable", async function () {
      const [deployer] = await ethers.getSigners();
      const claimable = await stakingContract.claimable(deployer.address);
      expect(claimable).to.be.equal(0);
    });

    it("Should donate unclaimed", async function () {
      const donationAmount = 0.001; // 0.001 ETH
      const donationAmountInWei = ethers.parseEther(donationAmount.toString());
      const result = await stakingContract.donate({ value: donationAmountInWei });
      expect(result).to.be.not.revertedWith("Not enough OLAS rewards to play the game");
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
      const totalUnclaimed2 = await stakingContract.getTotalUnclaimed();
      expect(totalUnclaimed2).to.be.eq(0);
    });
    it("Should donate only one donars unclaimed from 2 donors", async function () {
      const [deployer] = await ethers.getSigners();
      const donationAmountInWei = ethers.parseEther("0.001");
      const olasToken = await ethers.getContractAt("IERC20", incentiveTokenAddress);

      // Create two funded wallets
      const wallets = await Promise.all(
        Array.from({ length: 2 }, async () => {
          const w = ethers.Wallet.createRandom().connect(ethers.provider);
          await deployer.sendTransaction({
            to: w.address,
            value: ethers.parseEther("1"),
          });
          return w;
        }),
      );

      // Both wallets donate
      for (const w of wallets) {
        await stakingContract.connect(w).donate({ value: donationAmountInWei });
      }

      // Both should have equal shares
      const shares = await Promise.all(wallets.map(w => stakingContract.getCurrentShare(w.address)));
      expect(shares[0]).to.equal(shares[1]);

      // Advance to end of epoch
      const currentEpoch = await stakingContract.currentEpoch();
      let blocks = await stakingContract.getBlocksRemaining();
      for (let i = 0; i < Number(blocks); i++) {
        await network.provider.send("evm_mine");
      }
      await stakingContract.endEpoch();
      expect(await stakingContract.currentEpoch()).to.equal(currentEpoch + 1n);

      // Wallet 0 claims
      const preClaimBalance = await olasToken.balanceOf(wallets[0].address);
      const claimable0 = await stakingContract.claimable(wallets[0].address);
      expect(claimable0).to.be.gt(0);
      await stakingContract.connect(wallets[0]).claim();
      const postClaimBalance = await olasToken.balanceOf(wallets[0].address);
      expect(postClaimBalance).to.be.gt(preClaimBalance);

      // Advance and end second epoch
      blocks = await stakingContract.getBlocksRemaining();
      for (let i = 0; i < Number(blocks); i++) {
        await network.provider.send("evm_mine");
      }

      const totalUnclaimedBefore = await stakingContract.getTotalUnclaimed();
      expect(totalUnclaimedBefore).to.be.gt(0);
      await stakingContract.endEpoch();

      const totalUnclaimedAfter = await stakingContract.getTotalUnclaimed();
      expect(totalUnclaimedAfter).to.equal(0);
      // // check total unclaimed which should be now be nothing as all unclaimed should be donated
      // confirm we can call the topUp function
    });
    it("Should allow ending epoch with 3 donors", async function () {
      const [deployer] = await ethers.getSigners();
      const donationAmountInWei = ethers.parseEther("0.001");
      const olasToken = await ethers.getContractAt("IERC20", incentiveTokenAddress);

      // Create two funded wallets
      const wallets = await Promise.all(
        Array.from({ length: 3 }, async () => {
          const w = ethers.Wallet.createRandom().connect(ethers.provider);
          await deployer.sendTransaction({
            to: w.address,
            value: ethers.parseEther("1"),
          });
          return w;
        }),
      );

      // Both wallets donate
      for (const w of wallets) {
        await stakingContract.connect(w).donate({ value: donationAmountInWei });
      }

      // Both should have equal shares
      const shares = await Promise.all(wallets.map(w => stakingContract.getCurrentShare(w.address)));
      expect(shares[0]).to.equal(shares[1]);

      // Advance to end of epoch
      const currentEpoch = await stakingContract.currentEpoch();
      let blocks = await stakingContract.getBlocksRemaining();
      for (let i = 0; i < Number(blocks); i++) {
        await network.provider.send("evm_mine");
      }
      await stakingContract.endEpoch();
      expect(await stakingContract.currentEpoch()).to.equal(currentEpoch + 1n);

      // Wallets claim
      // const preClaimBalance = await olasToken.balanceOf(wallets[0].address);
      // const claimable0 = await stakingContract.claimable(wallets[0].address);
      // expect(claimable0).to.be.gt(0);
      // await stakingContract.connect(wallets[0]).claim();
      // const postClaimBalance = await olasToken.balanceOf(wallets[0].address);
      // expect(postClaimBalance).to.be.gt(preClaimBalance);
      for (const w of wallets) {
        const preClaimBalance = await olasToken.balanceOf(w.address);
        const claimable = await stakingContract.claimable(w.address);
        expect(claimable).to.be.gt(0);
        await stakingContract.connect(w).claim();
        const postClaimBalance = await olasToken.balanceOf(w.address);
        expect(postClaimBalance).to.be.gt(preClaimBalance);
      }

      // Advance and end second epoch
      blocks = await stakingContract.getBlocksRemaining();
      for (let i = 0; i < Number(blocks); i++) {
        await network.provider.send("evm_mine");
      }

      const totalUnclaimedBefore = await stakingContract.getTotalUnclaimed();
      expect(totalUnclaimedBefore).to.be.gt(0);
      await stakingContract.endEpoch();

      const totalUnclaimedAfter = await stakingContract.getTotalUnclaimed();
      expect(totalUnclaimedAfter).to.equal(0);
      // // check total unclaimed which should be now be nothing as all unclaimed should be donated
      // confirm we can call the topUp function
    });
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
    it("Should allow only the owner to drain the incentive balance", async function () {
      const [deployer, user] = await ethers.getSigners();
      const olasToken = await ethers.getContractAt("IERC20", incentiveTokenAddress);
      const initialBalance = await olasToken.balanceOf(deployer.address);
      // try to drain the balance as a user
      await expect(stakingContract.connect(user).drainIncentiveBalance()).to.be.revertedWithCustomError(
        stakingContract,
        "OwnableUnauthorizedAccount",
      );
      // drain the balance as the owner
      await stakingContract.connect(deployer).drainIncentiveBalance();
      const newBalance = await olasToken.balanceOf(deployer.address);
      expect(newBalance).to.be.gt(initialBalance);
      expect(await stakingContract.incentiveBalance()).to.equal(0);
    });
  });
});
