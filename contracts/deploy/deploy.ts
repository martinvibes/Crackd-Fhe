/**
 * Deploys the Crackd Confidential contract suite to the target network.
 *
 *   CrackdFHE   — confidential code-breaking engine (the showcase)
 *   CrackdDuel  — PvP staked escrow (ERC-20)
 *   CrackdVault — vs-AI prize pool + leaderboard (ERC-20)
 *
 * On non-Sepolia local networks it also deploys MockERC20 stand-ins so the
 * full flow can be exercised without real testnet tokens.
 *
 * Writes the resulting address book to deployments/<network>.json.
 */
import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const MIN_STAKE = ethers.parseUnits("1", 6); // 1 USDC-equiv (6dp) default floor

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deploying with admin ${admin.address} on ${network.name}`);

  const isLocal = network.name === "hardhat" || network.name === "localhost";

  // Optional mock tokens for local/dev.
  const tokens: Record<string, string> = {};
  if (isLocal) {
    const Mock = await ethers.getContractFactory("MockERC20");
    const usdc = await Mock.deploy("Mock USDC", "USDC", 6);
    await usdc.waitForDeployment();
    const weth = await Mock.deploy("Mock WETH", "WETH", 18);
    await weth.waitForDeployment();
    tokens.USDC = await usdc.getAddress();
    tokens.WETH = await weth.getAddress();
    console.log("MockERC20 USDC:", tokens.USDC, "WETH:", tokens.WETH);
  }

  const FHE = await ethers.getContractFactory("CrackdFHE");
  const fhe = await FHE.deploy();
  await fhe.waitForDeployment();

  const Duel = await ethers.getContractFactory("CrackdDuel");
  const duel = await Duel.deploy(admin.address, MIN_STAKE);
  await duel.waitForDeployment();

  const Vault = await ethers.getContractFactory("CrackdVault");
  const vault = await Vault.deploy(admin.address);
  await vault.waitForDeployment();

  const book = {
    network: network.name,
    admin: admin.address,
    deployedAt: new Date().toISOString(),
    tokens,
    contracts: {
      crackd_fhe: await fhe.getAddress(),
      crackd_duel: await duel.getAddress(),
      crackd_vault: await vault.getAddress(),
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  writeFileSync(outFile, JSON.stringify(book, null, 2));
  console.log("Wrote", outFile);
  console.log(JSON.stringify(book, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
