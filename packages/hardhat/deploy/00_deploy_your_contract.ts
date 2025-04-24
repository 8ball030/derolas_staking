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

  const minimumDonation: number = 1000000000000000; // 0.001 ETH
  const balancerRouter: string = "0x3f170631ed9821ca51a59d996ab095162438dc10";
  const poolId: string = "0xaf5b7999f491c42c05b5a2ca80f1d200d617cc8c";
  const assetsInPool: number = 8;
  const wethIndex: number = 1;
  const olasIndex: number = 4;
  const incentiveTokenAddress: string = "0x54330d28ca3357f294334bdc454a032e7f353416";

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
  console.log("👋 Can Currently play:", await staking.canPlayGame());
};

export default deployYourContract;

// Tags are useful if you have multiple deploy files and only want to run one of them.
// e.g. yarn deploy --tags YourContract
deployYourContract.tags = ["DerolasStaking"];
