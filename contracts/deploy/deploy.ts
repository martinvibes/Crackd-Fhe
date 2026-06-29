/**
 * Idempotent, resilient Sepolia/local deploy.
 *
 * Re-running is safe and cheap: anything already recorded in
 * deployments/<network>.json (and present on-chain) is skipped, so a top-up +
 * re-run continues exactly where a prior out-of-gas run stopped.
 *
 * Deploys, in priority order:
 *   CrackdFHE   — confidential engine (Confidential mode)
 *   CrackdDuel  — PvP staked escrow
 *   CrackdVault — vs-AI prize pool
 *   Test USDC / WETH (MockERC20, public mint) — stake tokens for the demo
 * then seeds the vault pools so vs-AI staked payouts work.
 */
import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const MIN_STAKE = ethers.parseUnits("1", 6);
const SEED = { USDC: { dec: 6, amount: "100000" }, WETH: { dec: 18, amount: "50" } };

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deploying with ${admin.address} on ${network.name}`);

  const outDir = path.join(__dirname, "..", "deployments");
  const outFile = path.join(outDir, `${network.name}.json`);
  type Book = { network: string; admin: string; tokens: Record<string, string>; contracts: Record<string, string> };
  let book: Book = { network: network.name, admin: admin.address, tokens: {}, contracts: {} };
  if (existsSync(outFile)) {
    try {
      const prev = JSON.parse(readFileSync(outFile, "utf8"));
      book = { ...book, ...prev, tokens: prev.tokens ?? {}, contracts: prev.contracts ?? {} };
    } catch {
      /* start fresh */
    }
  }
  book.admin = admin.address;
  book.network = network.name;
  const flush = () => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outFile, JSON.stringify(book, null, 2));
  };
  const hasCode = async (a?: string) => !!a && (await ethers.provider.getCode(a)) !== "0x";

  async function ensureContract(label: string, key: string, factory: string, args: unknown[]) {
    if (await hasCode(book.contracts[key])) {
      console.log(`= ${label} already at ${book.contracts[key]}`);
      return;
    }
    const f = await ethers.getContractFactory(factory);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    book.contracts[key] = await c.getAddress();
    flush();
    console.log(`+ ${label}: ${book.contracts[key]}`);
  }

  async function ensureToken(sym: string, decimals: number) {
    if (await hasCode(book.tokens[sym])) {
      console.log(`= token ${sym} already at ${book.tokens[sym]}`);
      return;
    }
    const M = await ethers.getContractFactory("MockERC20");
    const t = await M.deploy(`Crackd Test ${sym}`, sym, decimals);
    await t.waitForDeployment();
    book.tokens[sym] = await t.getAddress();
    flush();
    console.log(`+ token ${sym}: ${book.tokens[sym]}`);
  }

  async function seedVault(sym: string) {
    const tokenAddr = book.tokens[sym];
    const vaultAddr = book.contracts.crackd_vault;
    if (!tokenAddr || !vaultAddr) return;
    const vault = await ethers.getContractAt("CrackdVault", vaultAddr);
    if ((await vault.getPoolBalance(tokenAddr)) > 0n) {
      console.log(`= vault ${sym} pool already funded`);
      return;
    }
    const { dec, amount } = SEED[sym as keyof typeof SEED];
    const amt = ethers.parseUnits(amount, dec);
    const token = await ethers.getContractAt("MockERC20", tokenAddr);
    await (await token.mint(admin.address, amt)).wait();
    await (await token.approve(vaultAddr, amt)).wait();
    await (await vault.adminDeposit(tokenAddr, amt)).wait();
    console.log(`seeded vault ${sym} pool with ${amount}`);
  }

  // Each step is independent; an out-of-gas stop preserves prior progress.
  const steps: Array<[string, () => Promise<void>]> = [
    ["CrackdFHE", () => ensureContract("CrackdFHE", "crackd_fhe", "CrackdFHE", [])],
    ["CrackdDuel", () => ensureContract("CrackdDuel", "crackd_duel", "CrackdDuel", [admin.address, MIN_STAKE])],
    ["CrackdVault", () => ensureContract("CrackdVault", "crackd_vault", "CrackdVault", [admin.address])],
    ["USDC", () => ensureToken("USDC", 6)],
    ["WETH", () => ensureToken("WETH", 18)],
    ["seed USDC", () => seedVault("USDC")],
    ["seed WETH", () => seedVault("WETH")],
  ];

  let stopped = false;
  for (const [label, run] of steps) {
    if (stopped) {
      console.log(`↷ skipping ${label}`);
      continue;
    }
    try {
      await run();
    } catch (e) {
      console.error(`x ${label}: ${(e as Error).message.split("\n")[0]}`);
      stopped = true;
    }
  }

  flush();
  console.log("\nWrote", outFile);
  console.log(JSON.stringify(book, null, 2));
  if (stopped) console.log("\nTop up the deployer with Sepolia ETH and re-run — it resumes where it stopped.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
