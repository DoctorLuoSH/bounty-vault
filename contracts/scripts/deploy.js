const hre = require("hardhat");

async function main() {
  if (hre.network.name === "sepolia") {
    if (!process.env.SEPOLIA_RPC_URL) {
      throw new Error(
        "SEPOLIA_RPC_URL is not set. Copy .env.example to .env and fill it in."
      );
    }
    if (!process.env.PRIVATE_KEY) {
      throw new Error(
        "PRIVATE_KEY is not set. Copy .env.example to .env and fill it in."
      );
    }
  }

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Network:          ${hre.network.name}`);
  console.log(`Deployer:         ${deployer.address}`);
  console.log(`Deployer balance: ${hre.ethers.formatEther(balance)} ETH`);

  const BountyVault = await hre.ethers.getContractFactory("BountyVault");
  const vault = await BountyVault.deploy();
  await vault.waitForDeployment();

  const address = await vault.getAddress();
  const deployTx = vault.deploymentTransaction();
  const receipt = await deployTx.wait();

  console.log(`BountyVault:      ${address}`);
  console.log(`Deployment tx:    ${deployTx.hash}`);
  console.log(`Deployment block: ${receipt.blockNumber}`);
  console.log(
    "Next: set CONTRACT_ADDRESS + DEPLOYMENT_BLOCK in backend/.env and " +
      "VITE_CONTRACT_ADDRESS in frontend/.env"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
