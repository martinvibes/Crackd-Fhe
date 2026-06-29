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

  const outDir = path.join(__dirname, "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);

  // Resilient, incremental: record each address as soon as it lands so an
  // out-of-gas failure on a later contract never loses an earlier deploy.
  const contracts: Record<string, string> = {};
  const book = () => ({
    network: network.name,
    admin: admin.address,
    tokens,
    contracts,
  });
  const flush = () => writeFileSync(outFile, JSON.stringify(book(), null, 2));

  async function deploy(label: string, key: string, factory: string, args: unknown[]) {
    try {
      const f = await ethers.getContractFactory(factory);
      const c = await f.deploy(...args);
      await c.waitForDeployment();
      contracts[key] = await c.getAddress();
      flush();
      console.log(`✔ ${label}: ${contracts[key]}`);
    } catch (e) {
      console.error(`x ${label} failed: ${(e as Error).message.split("\n")[0]}`);
      throw e;
    }
  }

  // CrackdFHE first — it's the only contract the Confidential showcase needs.
  let failed = false;
  for (const step of [
    { label: "CrackdFHE", key: "crackd_fhe", factory: "CrackdFHE", args: [] as unknown[] },
    { label: "CrackdDuel", key: "crackd_duel", factory: "CrackdDuel", args: [admin.address, MIN_STAKE] },
    { label: "CrackdVault", key: "crackd_vault", factory: "CrackdVault", args: [admin.address] },
  ]) {
    if (failed) {
      console.log(`↷ skipping ${step.label} (a prior deploy failed — likely out of gas)`);
      continue;
    }
    try {
      await deploy(step.label, step.key, step.factory, step.args);
    } catch {
      failed = true;
    }
  }

  console.log("\nWrote", outFile);
  console.log(JSON.stringify(book(), null, 2));
  if (failed) {
    console.log(
      "\nSome contracts didn't deploy (top up the deployer with Sepolia ETH and re-run).",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
