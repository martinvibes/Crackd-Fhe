# Crackd Confidential — fhEVM Contracts

The on-chain layer for **Crackd Confidential**, the code-breaking game rebuilt on
[Zama's fhEVM](https://docs.zama.org/protocol). The secret code lives **encrypted
on-chain** and the contract referees every guess on ciphertext — nobody, not even
the chain, ever sees the digits.

## Contracts

| Contract | Role |
| --- | --- |
| **`CrackdFHE.sol`** | The confidential code-breaking engine (the showcase). A setter commits an encrypted 4-digit code; guessers submit plaintext guesses; the contract computes Mastermind **black pegs** (right digit + place = ● POT) and **white pegs** (right digit, wrong place = ○ PAN) **on the encrypted secret**. Feedback handles are decryptable only by the guesser via the relayer. |
| **`CrackdDuel.sol`** | Multi-asset PvP staked escrow (ERC-20). `Waiting → Active → Completed/Refunded/Expired`. Faithful EVM port of the Soroban duel. |
| **`CrackdVault.sol`** | vs-AI prize pool + per-asset leaderboards, daily-cap rewards. EVM port of the Soroban vault. |

### Why FHE and not commit-reveal?

A hash commitment hides the code, but **someone** still has to compute the peg
feedback off-chain and could lie until the reveal. `CrackdFHE` makes the
**contract itself** the referee on encrypted data — provably honest every turn,
no trusted code-setter, and no ZK circuit. That is the property that makes this
an FHE showcase rather than another confidential-ERC20.

### The hard part: frequency-capped white pegs

Wordle-style "is this letter present?" is a single bitmask AND. Mastermind is
harder because of **duplicate digits**: the white-peg count needs
`min(count_in_guess, count_in_secret)` per digit value, minus the black pegs.
`CrackdFHE.submitGuess` does this entirely on ciphertext with `FHE.eq`,
`FHE.min`, `FHE.add`, `FHE.sub` and `FHE.select`. The test suite verifies the
duplicate handling against the mock coprocessor.

## Develop

```bash
npm install
npm run compile          # solc 0.8.27, evmVersion cancun
npm test                 # runs CrackdDuel + CrackdFHE (mock coprocessor) tests
```

Tests require Node — the `@zama-fhe/relayer-sdk` mock utilities prefer Node 22+.

## Deploy (Sepolia)

```bash
cp .env.example .env      # set SEPOLIA_RPC_URL + ADMIN_PRIVATE_KEY
npm run deploy:sepolia
```

The deploy script writes the address book to `deployments/sepolia.json`. Copy the
three contract addresses into the backend and frontend `.env` files
(`CRACKD_FHE_ADDRESS`, `CRACKD_DUEL_ADDRESS`, `CRACKD_VAULT_ADDRESS`).

For a local end-to-end run, `npm run node` then `npm run deploy:local` (also
deploys `MockERC20` stand-ins for USDC/WETH).

## fhEVM notes

- Contracts inherit `ZamaEthereumConfig` (`@fhevm/solidity@^0.11`), which wires
  the ACL / coprocessor / KMS addresses for Ethereum mainnet **and** Sepolia.
- Encrypted inputs (`externalEuint8[4]` + `bytes proof`) are produced client-side
  by the relayer SDK; the contract converts them with `FHE.fromExternal`.
- Feedback ciphertext handles get `FHE.allow(handle, guesser)` so only that
  player can user-decrypt them off-chain.
