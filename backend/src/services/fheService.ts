/**
 * FheService — server side of the CONFIDENTIAL vs-AI game.
 *
 * The Vault's secret code is generated here, encrypted with the Zama relayer,
 * and committed to CrackdFHE as ciphertext (the admin key is the "setter").
 * The human then submits guesses from their own wallet; the contract scores
 * POT/PAN on the encrypted code and the pegs decrypt only for the guesser.
 *
 * So the Vault's code lives on-chain as ciphertext — the chain never sees it,
 * and the player cracks it confidentially. This is the confidential gameplay.
 *
 * Uses the relayer SDK's node build (works on Node 20 despite the >=22 hint).
 */
import { ethers } from "ethers";
import { randomInt } from "node:crypto";
import * as relayer from "@zama-fhe/relayer-sdk/node";
import type { AppConfig } from "../config.js";
import { logger } from "../utils/logger.js";

const FHE_ABI = [
  "function createGame(bytes32[4] encDigits, bytes proof) returns (bytes32)",
  "event GameCreated(bytes32 indexed gameId, address indexed setter)",
];

type RelayerInstance = {
  createEncryptedInput: (
    contractAddress: string,
    userAddress: string,
  ) => {
    add8: (v: number) => unknown;
    encrypt: () => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>;
  };
};

export class FheService {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly admin: ethers.Wallet;
  private readonly fheAddress: string;
  private readonly rpcUrl: string;
  private instance: RelayerInstance | null = null;

  constructor(cfg: AppConfig) {
    // Longer request timeout + static network so a slow public RPC doesn't
    // trip the default and 500 the seal.
    const req = new ethers.FetchRequest(cfg.EVM_RPC_URL);
    req.timeout = 60_000;
    this.provider = new ethers.JsonRpcProvider(
      req,
      { chainId: cfg.EVM_CHAIN_ID, name: cfg.EVM_NETWORK },
      { staticNetwork: true },
    );
    this.admin = new ethers.Wallet(cfg.ADMIN_PRIVATE_KEY, this.provider);
    this.fheAddress = cfg.CRACKD_FHE_ADDRESS;
    this.rpcUrl = cfg.EVM_RPC_URL;
    // Warm the relayer instance in the background so the first game isn't slow.
    void this.getInstance().catch(() => {});
  }

  private async getInstance(): Promise<RelayerInstance> {
    if (!this.instance) {
      const sdk = relayer as unknown as {
        initSDK?: () => Promise<void>;
        createInstance: (cfg: unknown) => Promise<RelayerInstance>;
        SepoliaConfig: Record<string, unknown>;
      };
      if (sdk.initSDK) await sdk.initSDK();
      this.instance = await sdk.createInstance({
        ...sdk.SepoliaConfig,
        network: this.rpcUrl,
      });
    }
    return this.instance;
  }

  /**
   * Generate + seal a fresh Vault code on-chain (encrypted). Returns the
   * on-chain game id (0x…) the player will submit guesses against, plus the
   * plaintext code (kept server-side only, for win verification / analytics).
   */
  async sealVaultCode(): Promise<{ gameId: string; code: string }> {
    // The Zama relayer's input-proof endpoint intermittently connect-times-out
    // / 500s from server environments. It's transient, so retry a few times
    // with backoff — one attempt almost always lands.
    const MAX = 5;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        return await this.sealOnce();
      } catch (err) {
        lastErr = err;
        logger.warn(
          { attempt, msg: (err as Error)?.message?.slice(0, 120) },
          "confidential: seal attempt failed, retrying",
        );
        if (attempt < MAX) await sleep(700 * attempt);
      }
    }
    throw lastErr;
  }

  private async sealOnce(): Promise<{ gameId: string; code: string }> {
    const code = randomCode();
    const fhe = await this.getInstance();
    const input = fhe.createEncryptedInput(this.fheAddress, this.admin.address);
    for (const ch of code) input.add8(Number(ch));
    const enc = await input.encrypt();

    const contract = new ethers.Contract(this.fheAddress, FHE_ABI, this.admin);
    const createGame = contract.getFunction("createGame");
    const tx = await createGame(enc.handles, enc.inputProof);
    const rc = await tx.wait();

    let gameId = "";
    for (const log of rc?.logs ?? []) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "GameCreated") {
          gameId = parsed.args.gameId as string;
          break;
        }
      } catch {
        /* not our event */
      }
    }
    if (!gameId) throw new Error("failed to seal Vault code (no GameCreated)");
    logger.info({ gameId }, "confidential: sealed Vault code");
    return { gameId, code };
  }

  /** Top a player up with a little Sepolia ETH so they can submit guesses. */
  async dripGas(address: string): Promise<string | null> {
    const MIN = ethers.parseEther("0.02");
    const TARGET = ethers.parseEther("0.04");
    const bal = await this.provider.getBalance(address);
    if (bal >= MIN) return null;
    const tx = await this.admin.sendTransaction({ to: address, value: TARGET - bal });
    await tx.wait();
    return tx.hash;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A valid Crackd code: 4 distinct digits, unbiased. */
function randomCode(): string {
  const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const a = digits[i]!;
    digits[i] = digits[j]!;
    digits[j] = a;
  }
  return digits.slice(0, 4).join("");
}
