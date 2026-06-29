#!/usr/bin/env node
/**
 * After `cd contracts && npm run deploy:sepolia`, run:
 *   node scripts/sync-addresses.mjs
 *
 * Reads contracts/deployments/sepolia.json and writes the deployed contract
 * (and any token) addresses into backend/.env.local and frontend/.env.local,
 * upserting only the relevant keys and leaving everything else untouched.
 * Creates the .env.local files from .env.example if they don't exist yet.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bookPath = path.join(root, "contracts/deployments/sepolia.json");

if (!existsSync(bookPath)) {
  console.error(
    "No contracts/deployments/sepolia.json found. Deploy first:\n  cd contracts && npm run deploy:sepolia",
  );
  process.exit(1);
}

const book = JSON.parse(readFileSync(bookPath, "utf8"));
const c = book.contracts ?? {};
const t = book.tokens ?? {};

/** key → value pairs to set, skipping any with no value. */
function pairs(map) {
  return Object.entries(map).filter(([, v]) => v && String(v).length > 0);
}

const backend = pairs({
  CRACKD_FHE_ADDRESS: c.crackd_fhe,
  CRACKD_DUEL_ADDRESS: c.crackd_duel,
  CRACKD_VAULT_ADDRESS: c.crackd_vault,
  USDC_ADDRESS: t.USDC,
  WETH_ADDRESS: t.WETH,
});

const frontend = pairs({
  VITE_CRACKD_FHE_ADDRESS: c.crackd_fhe,
  VITE_CRACKD_DUEL_ADDRESS: c.crackd_duel,
  VITE_CRACKD_VAULT_ADDRESS: c.crackd_vault,
  VITE_USDC_ADDRESS: t.USDC,
  VITE_WETH_ADDRESS: t.WETH,
});

function upsert(file, exampleFile, kv) {
  if (!existsSync(file)) {
    if (existsSync(exampleFile)) copyFileSync(exampleFile, file);
    else writeFileSync(file, "");
  }
  let text = readFileSync(file, "utf8");
  for (const [k, v] of kv) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text += (text.endsWith("\n") || text === "" ? "" : "\n") + line + "\n";
  }
  writeFileSync(file, text);
  console.log(`updated ${path.relative(root, file)} (${kv.length} keys)`);
}

upsert(
  path.join(root, "backend/.env.local"),
  path.join(root, "backend/.env.example"),
  backend,
);
upsert(
  path.join(root, "frontend/.env.local"),
  path.join(root, "frontend/.env.example"),
  frontend,
);

console.log("\nAddresses synced. Restart the backend & frontend dev servers.");
if (!t.USDC || !t.WETH) {
  console.log(
    "Note: token addresses weren't in the deployment (mocks only deploy locally).",
  );
  console.log(
    "Set USDC_ADDRESS/WETH_ADDRESS (+ VITE_ variants) to real Sepolia ERC-20s for staking.",
  );
}
