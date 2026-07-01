/**
 * CrackdFHE bindings — the confidential code-breaking engine, on-chain.
 *
 * Flow:
 *   1. sealCode()  → encrypt the 4 secret digits client-side (relayer) and
 *      commit them with createGame(). The code lives on-chain as ciphertext.
 *   2. scoreGuessOnChain() → submitGuess() (the contract computes black/white
 *      pegs ON the ciphertext), then read the encrypted feedback and decrypt
 *      it for the guesser via the relayer's userDecrypt flow.
 *
 * The secret digits never appear on-chain or leave the setter's browser in
 * the clear — that's the whole point.
 */
import { Contract, type Signer } from "ethers";
import { encryptCode, decryptFeedback } from "./fhe";

const FHE_ADDRESS = import.meta.env.VITE_CRACKD_FHE_ADDRESS as string;

/** True once a CrackdFHE address is configured (i.e. contracts deployed). */
export function fheConfigured(): boolean {
  return !!FHE_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(FHE_ADDRESS);
}

export const FHE_EXPLORER = FHE_ADDRESS
  ? `https://sepolia.etherscan.io/address/${FHE_ADDRESS}`
  : "";

const ABI = [
  "function createGame(bytes32[4] encDigits, bytes proof) returns (bytes32)",
  "function submitGuess(bytes32 gameId, uint8[4] guess)",
  "function getFeedback(bytes32 gameId, address guesser) view returns (bytes32 black, bytes32 white, bytes32 solved, uint32 guessIndex)",
  "function closeGame(bytes32 gameId)",
  "event GameCreated(bytes32 indexed gameId, address indexed setter)",
];

/**
 * Encrypt + commit a secret code. Returns the on-chain game id and the
 * sealing tx hash.
 */
export async function sealCode(
  signer: Signer,
  digits: number[],
): Promise<{ gameId: string; txHash: string }> {
  const setter = await signer.getAddress();
  const { handles, inputProof } = await encryptCode(FHE_ADDRESS, setter, digits);

  const contract = new Contract(FHE_ADDRESS, ABI, signer);
  // `handles` are four 32-byte Uint8Arrays → bytes32[4]; inputProof → bytes.
  const tx = await contract.createGame(handles, inputProof);
  const receipt = await tx.wait();

  let gameId = "";
  for (const log of receipt?.logs ?? []) {
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
  if (!gameId) {
    throw new Error("Couldn't read the sealed game id from the transaction.");
  }
  return { gameId, txHash: tx.hash };
}

export interface OnChainPegs {
  txHash: string;
  pots: number; // black
  pans: number; // white
  solved: boolean;
}

/**
 * Submit a plaintext guess. The contract scores it on the encrypted secret;
 * we then read the encrypted feedback and decrypt it for the guesser.
 */
export async function scoreGuessOnChain(
  signer: Signer,
  gameId: string,
  guess: number[],
): Promise<OnChainPegs> {
  const contract = new Contract(FHE_ADDRESS, ABI, signer);
  const tx = await contract.submitGuess(gameId, guess);
  await tx.wait();

  const guesser = await signer.getAddress();
  const fb = await contract.getFeedback(gameId, guesser);
  const decoded = await decryptFeedback(
    { black: fb.black as string, white: fb.white as string, solved: fb.solved as string },
    FHE_ADDRESS,
    signer,
  );

  return {
    txHash: tx.hash,
    pots: decoded.black,
    pans: decoded.white,
    solved: decoded.solved,
  };
}

export function txExplorer(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}
