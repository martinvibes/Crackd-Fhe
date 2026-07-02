# Deploying Crackd

Three pieces: **contracts** (Sepolia, already deployed), **backend** (Railway),
**frontend** (Vercel). Do them in that order — the frontend needs the backend's
URL, and the backend needs the contract addresses.

The deployed Sepolia addresses are already in [`contracts/deployments/sepolia.json`](contracts/deployments/sepolia.json):

| Contract | Address |
|----------|---------|
| CrackdFHE | `0x9A050f34B461D984ca227874265Bc2969024257a` |
| CrackdVault | `0x7F0C85EC12dcE17Bf7eEaf1A6E79589497E73F2E` |
| CrackdDuel | `0xd6bA0ae6A7064CB34075f934cC5EF9d26613CF80` |
| USDC (test) | `0xe39bEDdF22805aE6FcBFe72D6bd8DAabAd3dea1F` |
| WETH (test) | `0x083a9Cf95706D186d5cE8DE745dB3BAB841ff83b` |

---

## 1. Verify the contracts on Etherscan

Makes the FHE source readable — a judge can open CrackdFHE and see `FHE.eq` /
`FHE.min` running on `euint8`. One command verifies all three:

```bash
cd contracts
# add your key to contracts/.env:  ETHERSCAN_API_KEY=xxxxxxxx
npm run verify:sepolia
```

Re-runnable — already-verified contracts are skipped.

---

## 2. Backend → Railway

The backend is a Node/Express + Socket.io server that needs Redis.

1. **New project** → *Deploy from GitHub repo* → pick `Crackd-Fhe`.
2. In the service **Settings → Root Directory**, set `backend`. (Railway then
   uses [`backend/railway.json`](backend/railway.json): `npm ci && npm run build`
   → `npm run start`, health-checked at `/health`.)
3. **Add Redis**: in the project, *New → Database → Redis*. Railway injects a
   `REDIS_URL` variable — reference it from the backend service as
   `REDIS_URL=${{Redis.REDIS_URL}}`. (The client already handles Railway's
   IPv6-only private host.)
4. **Environment variables** (Settings → Variables):

   | Variable | Value |
   |----------|-------|
   | `NODE_ENV` | `production` |
   | `EVM_RPC_URL` | your Sepolia RPC (e.g. `https://ethereum-sepolia-rpc.publicnode.com`) |
   | `EVM_CHAIN_ID` | `11155111` |
   | `EVM_NETWORK` | `sepolia` |
   | `ADMIN_PRIVATE_KEY` | the deployer/referee key (**testnet burner only**) |
   | `ADMIN_ADDRESS` | `0xb02E3e54efC126E539d4d7282ad414a4E53F7421` |
   | `CRACKD_FHE_ADDRESS` | `0x9A050f34B461D984ca227874265Bc2969024257a` |
   | `CRACKD_VAULT_ADDRESS` | `0x7F0C85EC12dcE17Bf7eEaf1A6E79589497E73F2E` |
   | `CRACKD_DUEL_ADDRESS` | `0xd6bA0ae6A7064CB34075f934cC5EF9d26613CF80` |
   | `USDC_ADDRESS` | `0xe39bEDdF22805aE6FcBFe72D6bd8DAabAd3dea1F` |
   | `WETH_ADDRESS` | `0x083a9Cf95706D186d5cE8DE745dB3BAB841ff83b` |
   | `RELAYER_URL` | Zama relayer URL (leave default from `.env.example`) |
   | `ANTHROPIC_API_KEY` | optional — enables Claude taunts (falls back without) |
   | `CORS_ORIGIN` | set **after** step 3 to your Vercel URL (comma-sep for multiple) |
   | `REDIS_URL` | `${{Redis.REDIS_URL}}` |

   `PORT` is provided by Railway automatically — don't set it.
5. Deploy. Note the public URL, e.g. `https://crackd-backend.up.railway.app`.
   Check `https://<url>/health` returns `{ "ok": true }`.

---

## 3. Frontend → Vercel

1. **Add New → Project** → import `Crackd-Fhe`.
2. **Root Directory**: `frontend`. Framework preset **Vite** (auto). Build
   `npm run build`, output `dist`. SPA routing is handled by
   [`frontend/vercel.json`](frontend/vercel.json).
3. **Environment variables**:

   | Variable | Value |
   |----------|-------|
   | `VITE_BACKEND_URL` | your Railway backend URL (from step 2) |
   | `VITE_EVM_RPC_URL` | your Sepolia RPC |
   | `VITE_EVM_CHAIN_ID` | `11155111` |
   | `VITE_CRACKD_FHE_ADDRESS` | `0x9A050f34B461D984ca227874265Bc2969024257a` |
   | `VITE_CRACKD_VAULT_ADDRESS` | `0x7F0C85EC12dcE17Bf7eEaf1A6E79589497E73F2E` |
   | `VITE_CRACKD_DUEL_ADDRESS` | `0xd6bA0ae6A7064CB34075f934cC5EF9d26613CF80` |
   | `VITE_USDC_ADDRESS` | `0xe39bEDdF22805aE6FcBFe72D6bd8DAabAd3dea1F` |
   | `VITE_WETH_ADDRESS` | `0x083a9Cf95706D186d5cE8DE745dB3BAB841ff83b` |
   | `VITE_RELAYER_URL` | Zama relayer URL (match the backend) |
   | `VITE_PRIVY_APP_ID` | optional — enables email/social login |
   | `VITE_WALLETCONNECT_PROJECT_ID` | optional — enables WalletConnect |

4. Deploy → note the URL, e.g. `https://crackd.vercel.app`.

---

## 4. Wire them together

1. Back in Railway, set `CORS_ORIGIN` to your Vercel URL (e.g.
   `https://crackd.vercel.app`) and redeploy the backend.
2. Open the Vercel URL, sign in on Sepolia, and play a Confidential Duel.
3. Add the live link to the top of [`README.md`](README.md).

**Security:** `ADMIN_PRIVATE_KEY` is a funded referee key — use a **testnet
burner**, never a key holding real funds. It lives only in Railway's env, never
in git.
