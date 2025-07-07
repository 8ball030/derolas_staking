import * as dotenv from "dotenv";
dotenv.config();
import { ethers, deployments } from "hardhat";
import { Wallet } from "ethers";
import password from "@inquirer/password";

async function main() {
  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;

  if (!encryptedKey) {
    console.error("Missing encrypted key");
    process.exit(1);
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });

  let wallet;
  try {
    wallet = await Wallet.fromEncryptedJson(encryptedKey, pass);
  } catch (err) {
    console.error(err);
    console.error("Failed to decrypt private key. Wrong password?");
    process.exit(1);
  }

  const provider = ethers.provider;
  const signer = wallet.connect(provider);

  // Load deployment
  const stakingDeployment = await deployments.get("DerolasStaking"); // must match name in deploy script
  const staking = new ethers.Contract(stakingDeployment.address, stakingDeployment.abi, signer);

  console.log(`Calling forceAdvanceEpoch on ${stakingDeployment.address}`);
  const tx = await staking.forceAdvanceEpoch();
  console.log(`Tx sent: ${tx.hash}`);
  await tx.wait();
  console.log("Epoch advanced");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
