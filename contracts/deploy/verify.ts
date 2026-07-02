/**
 * Verify all deployed Crackd contracts on Etherscan in one shot.
 *
 *   ETHERSCAN_API_KEY=... npx hardhat run deploy/verify.ts --network sepolia
 *
 * Reads deployments/<network>.json for the addresses and re-supplies each
 * contract's constructor args (must match deploy/deploy.ts). Already-verified
 * contracts are reported and skipped, so this is safe to re-run.
 */
import { network, run, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Must mirror deploy/deploy.ts.
const MIN_STAKE = ethers.parseUnits("1", 6); // 1 USDC (6 decimals)

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No deployments file at ${file} — deploy first.`);
  }
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const admin: string = dep.admin;
  const c = dep.contracts ?? {};

  const targets: { name: string; address?: string; args: unknown[] }[] = [
    { name: "CrackdFHE", address: c.crackd_fhe, args: [] },
    { name: "CrackdDuel", address: c.crackd_duel, args: [admin, MIN_STAKE] },
    { name: "CrackdVault", address: c.crackd_vault, args: [admin] },
  ];

  for (const t of targets) {
    if (!t.address) {
      console.log(`- ${t.name}: no address on record, skipping`);
      continue;
    }
    console.log(`\nVerifying ${t.name} @ ${t.address} …`);
    try {
      await run("verify:verify", {
        address: t.address,
        constructorArguments: t.args,
      });
      console.log(`  ✓ ${t.name} verified`);
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (/already verified/i.test(msg)) {
        console.log(`  ✓ ${t.name} already verified`);
      } else {
        console.error(`  ✗ ${t.name} failed: ${msg}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
