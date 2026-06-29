<p align="center">
  <img src="assets/logo-banner.svg" alt="Crackd" width="720" />
</p>

<p align="center">
  <strong>The code-breaking game where your secret code stays encrypted — even from the blockchain.</strong><br/>
  A 1v1 Mastermind duel settled on-chain, with the secret code committed as ciphertext and the feedback computed on encrypted data using Fully Homomorphic Encryption.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Zama-fhEVM-ff00a8" />
  <img src="https://img.shields.io/badge/Network-Ethereum_Sepolia-blue?logo=ethereum" />
  <img src="https://img.shields.io/badge/FHE-Confidential-purple" />
  <img src="https://img.shields.io/badge/License-MIT-green" />
</p>

---

## What is Crackd Confidential?

Crackd is a competitive code-breaking game. Each player sets a secret 4-digit code and takes turns guessing the opponent's. After each guess, feedback is given:

| Symbol | Meaning |
|--------|---------|
| **POT** ● | Right digit, right position (a *black peg*) |
| **PAN** ○ | Right digit, wrong position (a *white peg*) |
| **Miss** · | Digit not in the code |

First to crack all 4 positions wins. If staked, the smart contract settles the payout instantly — no disputes, no middleman.

**What makes this version different:** the secret code is **encrypted on-chain** and the contract computes the POT/PAN feedback **directly on the ciphertext** using [Zama's fhEVM](https://docs.zama.org/protocol). Nobody — not the opponent, not the server, not the chain itself — ever sees the digits.

### Why FHE and not commit-reveal?

A hash commitment hides the code, but **someone** still has to compute the feedback off-chain and could lie until the reveal. `CrackdFHE` makes the **contract itself** the referee on encrypted data — provably honest every turn, with **no trusted code-setter and no ZK circuit**. That is the property that turns Crackd from "a nice game" into an FHE showcase.

### Example Round

```
Secret:  5 8 3 1   ← committed ENCRYPTED on-chain (euint8[4])
Guess:   5 2 9 4  →  ● · · ·   (1 POT: the 5)      ← computed on ciphertext
Guess:   5 8 1 3  →  ● ● ○ ○   (2 POT, 2 PAN)
Guess:   5 8 3 1  →  ● ● ● ●   CRACKED.
```

The feedback handles are decryptable **only by the guesser** via the relayer's user-decryption flow — they read their own pegs client-side, near-instantly.

---

## Game Modes

| Mode | Stakes | Players | Description |
|------|--------|---------|-------------|
| **vs AI · free** | None | You vs The Vault | Warm up against the Pidgin-speaking AI. No wallet needed. |
| **vs AI · staked** | WETH or USDC | You vs The Vault | Stake to play. Win 2×–2.5× your stake from the community pool. |
| **Multiplayer · casual** | None | 1v1 humans | Invite a friend with a 6-char code. Bragging rights only. |
| **Multiplayer · staked** | WETH or USDC | 1v1 humans | Both escrow into the duel contract. Winner takes the pot minus a 2.5% protocol fee; draws refund both stakes. Settled atomically on-chain. |

### Reward Tiers (vs AI · staked)

Every winner gets **at least 2× their stake** back. Fast crackers earn a speed bonus:

| Guesses | Total Return | Bonus |
|---------|-------------|-------|
| 1–3 | **2.5×** | Lightning speed bonus |
| 4–5 | **2.25×** | Sharp speed bonus |
| 6+ | **2.0×** | Base win — still doubles your stake |

Pool protected by a 25% daily cap per player to prevent draining.

---

## The Vault — AI Opponent

The Vault is Crackd's AI code guardian. It speaks **West African Pidgin English**, talks trash after every guess, and plays to win.

**How it works (hybrid AI):**
1. **Algorithmic solver** narrows the candidate space after each guess using feedback — guarantees every AI guess is logically valid.
2. **Claude** picks *which* valid candidate to guess from a filtered shortlist — strategic reasoning + personality.
3. **Pidgin taunts** generated per-event by Claude — context-aware, never breaks character.

> *"E be like say you dey guess with your eye closed!"*
> — The Vault, after a player's bad guess

---

## The FHE engine — how the pegs are computed on ciphertext

The hard part isn't hiding the code; it's scoring a guess **without decrypting it**, including the tricky duplicate-digit case.

- **Black pegs (POT ●):** for each position `i`, `FHE.eq(secret[i], guess[i])` → encrypted boolean → summed.
- **White pegs (PAN ○):** Mastermind's white-peg count needs `min(count_in_guess, count_in_secret)` per digit value, then minus the black pegs. `CrackdFHE.submitGuess` does this entirely on ciphertext with `FHE.eq`, `FHE.min`, `FHE.add`, `FHE.sub`, and `FHE.select`.

This is genuinely non-trivial FHE — not a confidential-ERC20 clone. The test suite verifies the duplicate handling against the mock coprocessor (e.g. guess `[7,7,3,1]` vs secret `[7,3,7,1]` → `black=2, white=2`; `[1,1,1,1]` → `black=1, white=0`, no over-count).

---

## Confidential mode — the showcase (`/confidential`)

The headline feature lives at **`/confidential`**. It exercises `CrackdFHE`
end-to-end against real Sepolia transactions:

1. **Seal** — you pick a 4-digit code; it's encrypted to `euint8[4]` in your
   browser and committed with `createGame()`. The code is ciphertext on-chain.
2. **Crack** — The Vault (a client-side solver) proposes guesses; each is sent
   to `submitGuess()`, where the **contract scores the POT/PAN pegs on the
   encrypted code**. The encrypted result is decrypted only for you via the
   relayer, then fed back to the solver.
3. **Result** — the Vault cracks it or runs out of guesses. Throughout, your
   digits never appear on-chain in the clear — every scoring tx is linkable on
   Etherscan, and none of them reveal the code.

The page includes a side-by-side **"normal game leaks vs. Crackd Confidential
stays sealed"** panel and a plain-English "under the hood" breakdown — built for
judges to grok the FHE property in ten seconds.

### Demo script (90 seconds)

1. Open `/confidential`, connect a wallet on Sepolia.
2. Set a code (e.g. `5 8 3 1`) → **Seal on-chain**. Open the sealing tx on
   Etherscan — show that the stored input is ciphertext, not the digits.
3. Click **Score this guess on-chain** a few times. Each tx scores on the
   encrypted code; the pegs (● POT / ○ PAN) come back decrypted just for you.
4. Punchline: "The guesses and pegs are public. The code never was — not to the
   opponent, not to the server, not to the chain itself."

## Architecture

```
┌──────────────────────────────────┐
│  Frontend (Vite + React 19)      │  Wallet adapter pattern:
│  Tailwind + Framer Motion        │   • Injected EIP-1193 (MetaMask, …)
│                                  │   • @privy-io/react-auth
│                                  │     (email / Google / Apple →
│                                  │      embedded EVM wallet)
│                                  │   • @zama-fhe/relayer-sdk
│                                  │     (encrypt secret · user-decrypt pegs)
└──────────────┬───────────────────┘
               │ REST + Socket.io      players self-submit txs (ethers v6)
┌──────────────▼───────────────────┐
│  Backend (Node 20 + TypeScript)  │
│  Express · Socket.io · Redis     │
│  Hybrid AI (solver + Claude)     │
│  Admin referee (resolve/declare) │
└──┬─────────────────────────────┬─┘
   │ ethers v6                    │ @anthropic-ai/sdk
┌──▼──────────┐             ┌────▼──────┐
│  Zama fhEVM │             │  Claude   │
│  Sepolia    │             │  Haiku    │
└──┬──────────┘             └───────────┘
   │
 CrackdFHE   (confidential code-breaking engine — encrypted secret + on-chain pegs)
 CrackdVault (multi-asset prize pool, vs-AI staking, leaderboard)
 CrackdDuel  (PvP escrow, multi-asset)
```

### Smart Contracts (Solidity / fhEVM)

| Contract | Purpose |
|----------|---------|
| **CrackdFHE** | The confidential engine. Commit an encrypted 4-digit code (`euint8[4]`); compute POT/PAN feedback on ciphertext; feedback handles are ACL-granted to the guesser only. |
| **CrackdVault** | Community prize pool. `stake`, `resolveWin`, `resolveLoss`, 25% daily cap, per-asset leaderboard. Multi-asset (WETH + USDC). |
| **CrackdDuel** | PvP escrow. Create / join / declare winner / draw, 2.5% protocol fee, timeout + expiry. Multi-asset. |

Contracts inherit `ZamaEthereumConfig` (`@fhevm/solidity`), which wires the ACL / coprocessor / KMS addresses for Ethereum mainnet and Sepolia. See [`contracts/README.md`](contracts/README.md) for the full contract docs.

**Contract test coverage:** Hardhat suite covering the escrow flow (create → join → declare, fee math, refunds, min-stake) and the FHE peg engine (exact crack, frequency-capped white pegs, no duplicate over-count) against the mock coprocessor.

### Backend Services

| Service | Role |
|---------|------|
| `gameLogic.ts` | Pure game rules — validate codes, compute POT/PAN, check game-over. Unit-tested. |
| `zamaService.ts` | fhEVM/EVM contract calls via ethers v6 — provider reads, admin-signed writes (`resolveWin`/`resolveLoss`/`declareWinner`/`declareDraw`), best-effort player-tx receipt verification. |
| `aiService.ts` | Hybrid solver + Claude taunts. Candidate filtering + strategic LLM pick. |
| `gameHandler.ts` | Socket.io real-time orchestration. Per-socket views (no secret leaks). Captures the on-chain duel `gameId` at create time, declares winner/draw on game-over. |
| `gameState.ts` | Redis game sessions + invite codes + leaderboard + PvP earnings ledger + cross-mode streak tracking. |

### Wallet Auth — Two Paths, One Signer

A `WalletProvider` interface in [`frontend/src/lib/walletProvider.ts`](frontend/src/lib/walletProvider.ts) lets the rest of the app obtain an `ethers.Signer` without caring how the user signed in:

| Provider | Login flow | Use case |
|---|---|---|
| **Injected (EIP-1193)** | Click "Connect a wallet" → MetaMask / any injected wallet → switches to Sepolia | Crypto-native users |
| **Privy** | "Continue with email or social" → email OTP / Google / Apple → embedded **EVM** wallet auto-created → ready to play | Web2 users with no extension |

Players **self-submit** their own create/join/stake transactions on EVM (the backend no longer brokers a signed envelope). The admin key referees only — resolving wins, losses, and draws.

---

## Running Locally

### Prerequisites

- **Node.js** 20.19+ (Node 22+ recommended for the relayer SDK tooling)
- **Redis** (`brew install redis` or Docker)
- **An Ethereum Sepolia RPC URL** + a funded admin key (deployer / referee)
- **Anthropic API key** (optional — Claude taunts; game still works with fallbacks)

### 1. Clone & install

```bash
git clone https://github.com/martinvibes/Crackd-Fhe.git
cd Crackd-Fhe

cd contracts && npm install      # Hardhat + fhEVM
cd ../backend  && npm install
cd ../frontend && npm install
```

### 2. Deploy the contracts (Sepolia)

```bash
cd contracts
cp .env.example .env             # set SEPOLIA_RPC_URL + ADMIN_PRIVATE_KEY
npm run compile && npm test      # compile + run the test suite
npm run deploy:sepolia           # writes deployments/sepolia.json
```

Copy the three deployed addresses into the backend and frontend env files.

### 3. Configure & run

```bash
# Backend
cp backend/.env.example backend/.env.local
#   EVM_RPC_URL, ADMIN_PRIVATE_KEY, ADMIN_ADDRESS,
#   CRACKD_FHE_ADDRESS / CRACKD_DUEL_ADDRESS / CRACKD_VAULT_ADDRESS,
#   USDC_ADDRESS / WETH_ADDRESS, ANTHROPIC_API_KEY (optional)

# Frontend
cp frontend/.env.example frontend/.env.local
#   VITE_EVM_RPC_URL, VITE_CRACKD_*_ADDRESS, VITE_USDC_ADDRESS / VITE_WETH_ADDRESS,
#   VITE_RELAYER_URL, VITE_PRIVY_APP_ID (optional)

brew services start redis        # Terminal 1
cd backend  && npm run dev       # Terminal 2
cd frontend && npm run dev       # Terminal 3
```

Open `http://localhost:5173` — you're live.

---

## Project Structure

```
crackd-fhe/
├── contracts/                  # Hardhat + fhEVM (Solidity)
│   ├── contracts/
│   │   ├── CrackdFHE.sol        # confidential code-breaking engine
│   │   ├── CrackdDuel.sol       # PvP escrow (multi-asset)
│   │   ├── CrackdVault.sol      # prize pool + leaderboard (multi-asset)
│   │   └── mocks/MockERC20.sol
│   ├── deploy/deploy.ts · test/ · hardhat.config.ts
│   └── deployments/sepolia.json
├── backend/                    # Node.js + TypeScript
│   └── src/
│       ├── services/           # gameLogic, zamaService, aiService, assets
│       ├── socket/             # gameHandler, chatHandler, events
│       ├── routes/             # REST: pool, leaderboard, player, game, onboarding
│       └── store/              # Redis: gameState, invites, leaderboard, PvP earnings, streaks
├── frontend/                   # React 19 + Vite + Tailwind + Framer Motion
│   └── src/
│       ├── pages/              # Home, Game, Leaderboard, Profile
│       ├── components/         # ConnectModal, WalletButton, game board, …
│       └── lib/                # evm (contract calls), fhe (relayer), wallet,
│                               #   walletProvider, privy, balance, api, socket
└── docs/                       # Specs + plans
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Solidity 0.8.27 + `@fhevm/solidity` (Zama fhEVM), Hardhat |
| Confidentiality | Fully Homomorphic Encryption (Zama Protocol) · `@zama-fhe/relayer-sdk` |
| Backend | Node.js 20, TypeScript, Express, Socket.io, Redis, ethers v6 |
| Frontend | React 19, Vite, Tailwind, Framer Motion, ethers v6 |
| AI | Claude (Anthropic SDK) + deterministic solver |
| Wallet | Injected EIP-1193 (MetaMask, …) + @privy-io/react-auth (email / Google / Apple → embedded EVM wallet) |
| Blockchain | Ethereum Sepolia (Zama fhEVM) |

---

## Team

**Martin Machiebe** ([@martinvibes](https://github.com/martinvibes)) — Cypher Labs

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <img src="assets/logo-banner.svg" alt="Crackd" width="400" />
  <br />
  <em>The only code-breaking game where your code stays truly secret — even from the blockchain.</em>
</p>
