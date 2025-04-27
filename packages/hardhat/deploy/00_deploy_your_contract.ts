import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * Deploys a contract named "YourContract" using the deployer account and
 * constructor arguments set to the deployer address
 *
 * @param hre HardhatRuntimeEnvironment object.
 */
const deployYourContract: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
    On localhost, the deployer account is the one that comes with Hardhat, which is already funded.

    When deploying to live networks (e.g `yarn deploy --network sepolia`), the deployer account
    should have sufficient balance to pay for the gas fees for contract creation.

    You can generate a random account with `yarn generate` or `yarn account:import` to import your
    existing PK which will fill DEPLOYER_PRIVATE_KEY_ENCRYPTED in the .env file (then used on hardhat.config.ts)
    You can run the `yarn account` command to check your balance in every network.
  */
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const minimumDonation: number = 100000000000000; // 0.001 ETH
  const balancerRouter: string = "0x3f170631ed9821ca51a59d996ab095162438dc10";
  const poolId: string = "0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c";
  const assetsInPool: number = 8;
  const wethIndex: number = 1;
  const olasIndex: number = 3;
  const incentiveTokenAddress: string = "0x54330d28ca3357f294334bdc454a032e7f353416";

  console.log("👋 Deploying DerolasStaking contract...");
  console.log("Deployer address:", deployer);
  await deploy("DerolasStaking", {
    from: deployer,
    // Contract constructor arguments
    args: [
      deployer,
      minimumDonation,
      balancerRouter,
      poolId,
      assetsInPool,
      wethIndex,
      olasIndex,
      incentiveTokenAddress,
    ],
    log: true,
    // autoMine: can be passed to the deploy function to make the deployment process faster on local networks by
    // automatically mining the contract deployment transaction. There is no effect on live networks.
    autoMine: true,
  });

  // Get the deployed contract to interact with it after deploying.
  const staking = await hre.ethers.getContract<Contract>("DerolasStaking", deployer);
  console.log("👋 Epoch is to begin...");
  console.log("Staking contract deployed to:", staking.address);
  console.log("Staking contract deployed by:", deployer);
  // We get the currentEpoch from the contract
  const currentEpoch = await staking.currentEpoch();
  console.log("Current epoch is:", currentEpoch.toString());

  // We get the remaining blocks from the contract
  const remainingBlocks = await staking.getBlocksRemaining();
  console.log("Remaining blocks are:", remainingBlocks.toString());
  // we estimate the time left in seconds
  const blockTime = await hre.ethers.provider.getBlock("latest");
  if (!blockTime) {
    throw new Error("Failed to fetch the latest block time.");
  }
  const blockTimeInSeconds = blockTime.timestamp;
  const currentBlock = await hre.ethers.provider.getBlockNumber();
  const blockTimeDifference = blockTimeInSeconds - currentBlock;
  const secondsLeft = blockTimeDifference * 15; // assuming 15 seconds per block
  const minutesLeft = Math.floor(secondsLeft / 60);
  const hoursLeft = Math.floor(minutesLeft / 60);

  console.log("Game ready to play. Time left in blocks:", remainingBlocks.toString());
  console.log("Time left in seconds:", secondsLeft);
  console.log("Time left in minutes:", minutesLeft);
  console.log("Time left in hours:", hoursLeft);

  // We then end the spoch such that play can begin
};

export default deployYourContract;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags YourContract
deployYourContract.tags = ["DerolasStaking"];
