/**
 * Confidential FHE engine bindings — wraps @zama-fhe/relayer-sdk.
 *
 * This is the client side of CrackdFHE, the confidential Mastermind engine:
 * the code-setter encrypts their 4 secret digits and proves them with an
 * input proof; guessers submit plaintext guesses; the contract returns
 * ENCRYPTED feedback (black/white/solved as ciphertext handles) that only
 * the guesser can decrypt via the relayer's userDecrypt EIP-712 flow.
 *
 * REQUIRES the Zama relayer + Ethereum Sepolia to be reachable. The SDK is
 * a heavy WASM bundle, so it is lazily imported — getFheInstance() pulls it
 * in on first use and it never blocks the initial app bundle/build.
 */
import type { Signer } from "ethers";

// Read on-chain FHE config from our working RPC (the SDK's default can be a
// rate-limited/dead public endpoint). The relayer URL itself comes from the
// SDK's SepoliaConfig — overriding it with a stale env value 404s → "Bad JSON".
const RPC_URL = import.meta.env.VITE_EVM_RPC_URL as string;

// The SDK type surface is loaded lazily; we keep the instance loosely typed
// to avoid a static import of the (WASM-heavy) module at build time.
type FheInstance = {
  createEncryptedInput: (
    contractAddress: string,
    userAddress: string,
  ) => {
    add8: (v: number) => unknown;
    encrypt: () => Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }>;
  };
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number | string,
    durationDays: number | string,
  ) => {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    message: Record<string, unknown>;
  };
  userDecrypt: (
    handles: { handle: string; contractAddress: string }[],
    privateKey: string,
    publicKey: string,
    signature: string,
    contractAddresses: string[],
    userAddress: string,
    startTimestamp: number | string,
    durationDays: number | string,
  ) => Promise<Record<string, bigint | boolean>>;
};

let instancePromise: Promise<FheInstance> | null = null;

/** Lazily create (and cache) the relayer SDK instance configured for Sepolia. */
export async function getFheInstance(): Promise<FheInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const sdk = (await import("@zama-fhe/relayer-sdk/web")) as unknown as {
        initSDK: () => Promise<void>;
        createInstance: (config: unknown) => Promise<FheInstance>;
        SepoliaConfig: Record<string, unknown>;
      };
      await sdk.initSDK();
      const config = {
        ...sdk.SepoliaConfig,
        ...(RPC_URL ? { network: RPC_URL } : {}),
      };
      return sdk.createInstance(config);
    })();
  }
  return instancePromise;
}

/**
 * Encrypt the 4 secret digits for a CrackdFHE game and produce the input
 * proof. Pass the result handles/proof to CrackdFHE.createGame(encDigits, proof).
 */
export async function encryptCode(
  contractAddr: string,
  userAddr: string,
  digits: number[],
): Promise<{ handles: Uint8Array[]; inputProof: Uint8Array }> {
  if (digits.length !== 4) throw new Error("expected 4 digits");
  const fhe = await getFheInstance();
  const input = fhe.createEncryptedInput(contractAddr, userAddr);
  for (const d of digits) input.add8(d);
  return input.encrypt();
}

export interface DecryptedFeedback {
  black: number;
  white: number;
  solved: boolean;
}

/**
 * Decrypt the encrypted feedback handles (black/white/solved) returned by
 * CrackdFHE.getFeedback via the relayer userDecrypt EIP-712 flow.
 *
 * `handles` are the bytes32 ciphertext handles in order [black, white, solved].
 */
export async function decryptFeedback(
  handles: { black: string; white: string; solved: string },
  contractAddr: string,
  signer: Signer,
): Promise<DecryptedFeedback> {
  const fhe = await getFheInstance();
  const userAddress = await signer.getAddress();

  const { publicKey, privateKey } = fhe.generateKeypair();
  // The relayer SDK expects these as NUMBERS, not strings — passing strings
  // throws "InvalidTypeError … UintNumber string".
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const contractAddresses = [contractAddr];

  const eip712 = fhe.createEIP712(
    publicKey,
    contractAddresses,
    startTimestamp,
    durationDays,
  );

  // ethers v6 signTypedData wants the primary type's fields only.
  const types = eip712.types as Record<string, unknown> & {
    UserDecryptRequestVerification?: unknown;
  };
  const signature = await signer.signTypedData(
    eip712.domain as never,
    { UserDecryptRequestVerification: types.UserDecryptRequestVerification } as never,
    eip712.message as never,
  );

  const pairs = [
    { handle: handles.black, contractAddress: contractAddr },
    { handle: handles.white, contractAddress: contractAddr },
    { handle: handles.solved, contractAddress: contractAddr },
  ];

  const result = await fhe.userDecrypt(
    pairs,
    privateKey,
    publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    userAddress,
    startTimestamp,
    durationDays,
  );

  return {
    black: Number(result[handles.black] ?? 0),
    white: Number(result[handles.white] ?? 0),
    solved: Boolean(result[handles.solved] ?? false),
  };
}
