/**
 * Staked PvP socket flow smoke test (EVM / Zama fhEVM).
 *
 * TODO: port the full live flow to ethers v6. On EVM the two players must
 * self-submit their own on-chain txs:
 *   1. Fund two Sepolia wallets with test ETH (gas) + the stake ERC-20
 *      (WETH/USDC). Sepolia has no auto-faucet — use a public faucet.
 *   2. Each player `approve()`s the CrackdDuel contract for the stake.
 *   3. Alice calls `createGame(token, stake)`, reads the bytes32 gameId
 *      from the `GameCreated` event, then emits `create_game` over the
 *      socket with { walletAddress, mode: "pvp_staked", asset,
 *      stakeBaseUnits, contractGameId, txHash }.
 *   4. Bob calls `joinGame(gameId)` then emits `join_game` with txHash.
 *   5. Both set codes; Alice cracks Bob's code; assert game_over fires
 *      with a payoutTxHash (admin-signed declareWinner).
 *
 * Until that's wired up, this is a compile-only stub so the build stays
 * green. Run the casual flow via smokeSockets.ts in the meantime.
 */
import { Wallet } from "ethers";

async function main() {
  const alice = Wallet.createRandom().address;
  const bob = Wallet.createRandom().address;
  console.log(
    "smokePvpStaked is a stub on EVM — see the TODO at the top of this file.",
  );
  console.log("would-be players:", { alice, bob });
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ smokePvpStaked failed:", err);
  process.exit(1);
});
