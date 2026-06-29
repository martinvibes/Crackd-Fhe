/**
 * EVM contract helpers for the frontend.
 *
 * On EVM the player self-submits transactions: we build an ethers Contract
 * bound to the player's Signer and send the call directly to the chain.
 * After a tx confirms we notify the backend with { address, txHash, ... }
 * (see Game.tsx) — the backend no longer broadcasts anything.
 *
 * ABIs are inline human-readable fragments — we deliberately do NOT import
 * JSON artifacts from the contracts package.
 */
import { Contract, parseUnits, formatUnits, type Signer } from "ethers";

const DUEL_ADDRESS = import.meta.env.VITE_CRACKD_DUEL_ADDRESS as string;
const VAULT_ADDRESS = import.meta.env.VITE_CRACKD_VAULT_ADDRESS as string;

/** Resolve a stake-token symbol → its configured ERC-20 address (or null). */
export function tokenAddressFor(symbol: string): string | null {
  switch (symbol.toUpperCase()) {
    case "WETH":
      return (import.meta.env.VITE_WETH_ADDRESS as string) || null;
    case "USDC":
      return (import.meta.env.VITE_USDC_ADDRESS as string) || null;
    default:
      return null;
  }
}

// --- ABI fragments ---

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const DUEL_ABI = [
  "function createGame(address token, uint256 stake) returns (bytes32)",
  "function joinGame(bytes32 gameId)",
  "function cancelGame(bytes32 gameId)",
  "event GameCreated(bytes32 gameId, address playerOne, address token, uint256 stake)",
];

const VAULT_ABI = [
  "function stake(address token, uint256 amount)",
];

// --- ERC20 ---

export function getErc20(address: string, signer: Signer): Contract {
  return new Contract(address, ERC20_ABI, signer);
}

/**
 * Approve `spender` to pull `amount` of `token` if the current allowance
 * is insufficient. Waits for the approval tx to confirm before returning.
 */
export async function approveIfNeeded(
  token: string,
  spender: string,
  amount: bigint,
  signer: Signer,
): Promise<void> {
  const erc20 = getErc20(token, signer);
  const owner = await signer.getAddress();
  const current: bigint = await erc20.allowance(owner, spender);
  if (current >= amount) return;
  const tx = await erc20.approve(spender, amount);
  await tx.wait();
}

// --- Test-token faucet (MockERC20.mint is public on testnet) ---

const MINT_ABI = ["function mint(address to, uint256 amount)"];

/** Mint test tokens to the connected wallet so it can stake. Returns tx hash. */
export async function mintTestTokens(
  signer: Signer,
  token: string,
  amountHuman: number,
  decimals: number,
): Promise<string> {
  const to = await signer.getAddress();
  const c = new Contract(token, MINT_ABI, signer);
  const tx = await c.mint(to, parseUnits(String(amountHuman), decimals));
  await tx.wait();
  return tx.hash;
}

// --- CrackdDuel (staked PvP) ---

/**
 * `createGame(token, stake)` on the CrackdDuel. Approves the duel to pull
 * the stake first, then sends. Returns { gameId, txHash } once mined.
 */
export async function duelCreateGame(
  signer: Signer,
  token: string,
  stake: bigint,
): Promise<{ gameId: string; txHash: string }> {
  await approveIfNeeded(token, DUEL_ADDRESS, stake, signer);
  const duel = new Contract(DUEL_ADDRESS, DUEL_ABI, signer);
  const tx = await duel.createGame(token, stake);
  const receipt = await tx.wait();
  // Pull the gameId out of the GameCreated event.
  let gameId = "";
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = duel.interface.parseLog(log);
      if (parsed?.name === "GameCreated") {
        gameId = parsed.args.gameId as string;
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { gameId, txHash: tx.hash };
}

/** `joinGame(gameId)` on the CrackdDuel. The joiner must approve the stake
 *  to the duel first (same stake the creator set). */
export async function duelJoinGame(
  signer: Signer,
  gameId: string,
  token?: string,
  stake?: bigint,
): Promise<{ txHash: string }> {
  if (token && stake !== undefined) {
    await approveIfNeeded(token, DUEL_ADDRESS, stake, signer);
  }
  const duel = new Contract(DUEL_ADDRESS, DUEL_ABI, signer);
  const tx = await duel.joinGame(gameId);
  await tx.wait();
  return { txHash: tx.hash };
}

// --- CrackdVault (staked vs-AI) ---

/** `stake(token, amount)` on the CrackdVault. Approves first. */
export async function vaultStake(
  signer: Signer,
  token: string,
  amount: bigint,
): Promise<{ txHash: string }> {
  await approveIfNeeded(token, VAULT_ADDRESS, amount, signer);
  const vault = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
  const tx = await vault.stake(token, amount);
  await tx.wait();
  return { txHash: tx.hash };
}

// --- unit + format helpers ---

export function toBaseUnits(amount: number | string, decimals = 18): bigint {
  return parseUnits(String(amount), decimals);
}

export function fromBaseUnits(value: bigint | string, decimals = 18): number {
  return Number(formatUnits(value, decimals));
}

export function shortAddress(addr: string, chars = 4): string {
  if (!addr || addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}
