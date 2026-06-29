// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, ebool, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * CrackdFHE — the confidential code-breaking engine.
 *
 * This is the heart of "Crackd Confidential". A code-setter commits a secret
 * 4-digit code (each digit 0-9) ENCRYPTED on-chain. Guessers submit plaintext
 * guesses and the contract computes the Mastermind feedback — black pegs (right
 * digit, right place = "POT" ●) and white pegs (right digit, wrong place =
 * "PAN" ○) — directly on the ciphertext. The code is never revealed; nobody,
 * not even the chain, sees the digits.
 *
 * Why FHE and not commit-reveal? With a hash commitment, SOMEONE has to compute
 * the peg feedback off-chain and could lie until the reveal. Here the contract
 * itself referees on encrypted data — provably honest every turn, no trusted
 * code-setter, and no ZK circuit. That is the property that makes this an FHE
 * showcase rather than yet another confidential-ERC20.
 *
 * Feedback handles are made decryptable only to the guesser (via the relayer
 * user-decryption / EIP-712 flow) so they read their pegs client-side, near
 * instantly. The "solved" flag is also exposed for the guesser; off-chain
 * orchestration (the backend) finalizes any staked escrow in CrackdDuel /
 * CrackdVault once a win is observed.
 *
 * NOTE ON CODE LENGTH / RANGE: defaults are CODE_LEN = 4, DIGIT_MAX = 9 to match
 * Crackd's classic mode. The peg math is general over those constants.
 */
contract CrackdFHE is ZamaEthereumConfig {
    // ----------------------------- constants -----------------------------

    uint8 public constant CODE_LEN = 4;
    uint8 public constant DIGIT_MAX = 9; // digits in [0, 9]

    // ----------------------------- types ---------------------------------

    enum GameStatus {
        None, // 0 — never created
        Open, // 1 — secret committed, accepting guesses
        Solved, // 2 — a guesser cracked it
        Closed // 3 — setter closed it
    }

    struct Game {
        address setter; // who committed the secret
        GameStatus status;
        uint32 guessCount; // total guesses submitted across all players
        uint64 createdAt;
        // Encrypted secret code: CODE_LEN encrypted digits.
        euint8[CODE_LEN] secret;
    }

    struct Feedback {
        euint8 black; // exact matches (POT ●)
        euint8 white; // value-but-wrong-place matches (PAN ○)
        euint8 solved; // 1 if black == CODE_LEN, else 0 (encrypted)
        uint32 guessIndex; // monotonic per-game guess number
        bool exists;
    }

    // ----------------------------- storage -------------------------------

    mapping(bytes32 => Game) private _games;
    // gameId => guesser => their latest feedback handles
    mapping(bytes32 => mapping(address => Feedback)) private _feedback;
    // per-setter monotonic nonce → deterministic game ids
    mapping(address => uint256) private _nonce;

    // ----------------------------- events --------------------------------

    event GameCreated(bytes32 indexed gameId, address indexed setter);
    event GuessSubmitted(
        bytes32 indexed gameId,
        address indexed guesser,
        uint32 guessIndex,
        uint8[CODE_LEN] guess
    );
    event GameClosed(bytes32 indexed gameId);

    // ----------------------------- errors --------------------------------

    error GameNotOpen();
    error NotSetter();
    error BadDigit();

    // ----------------------------- create --------------------------------

    /**
     * Commit a secret code. The caller encrypts CODE_LEN digits client-side
     * with the relayer SDK, producing `externalEuint8` handles plus a single
     * input `proof`. Returns the deterministic game id (share with opponents).
     */
    function createGame(
        externalEuint8[CODE_LEN] calldata encDigits,
        bytes calldata proof
    ) external returns (bytes32 gameId) {
        gameId = keccak256(abi.encodePacked(msg.sender, _nonce[msg.sender]++));

        Game storage g = _games[gameId];
        g.setter = msg.sender;
        g.status = GameStatus.Open;
        g.createdAt = uint64(block.timestamp);

        for (uint256 i = 0; i < CODE_LEN; i++) {
            euint8 d = FHE.fromExternal(encDigits[i], proof);
            g.secret[i] = d;
            // The contract must retain access to recompute against future guesses.
            FHE.allowThis(d);
        }

        emit GameCreated(gameId, msg.sender);
    }

    // ----------------------------- guess ---------------------------------

    /**
     * Submit a plaintext guess. The guess is public (in Mastermind only the
     * code is secret); the contract compares it against the encrypted secret
     * and stores encrypted black/white peg counts readable only by the guesser.
     */
    function submitGuess(bytes32 gameId, uint8[CODE_LEN] calldata guess) external {
        Game storage g = _games[gameId];
        if (g.status != GameStatus.Open) revert GameNotOpen();

        // ---- black pegs: exact position matches ----
        euint8 black = FHE.asEuint8(0);
        for (uint256 i = 0; i < CODE_LEN; i++) {
            if (guess[i] > DIGIT_MAX) revert BadDigit();
            ebool hit = FHE.eq(g.secret[i], guess[i]); // scalar compare
            black = FHE.add(black, _toU8(hit));
        }

        // ---- total value-matches (frequency capped), then white = total - black ----
        // multiplicity of each digit value in the guess (plaintext)
        uint8[DIGIT_MAX + 1] memory gm;
        for (uint256 i = 0; i < CODE_LEN; i++) {
            gm[guess[i]] += 1;
        }

        euint8 total = FHE.asEuint8(0);
        for (uint8 v = 0; v <= DIGIT_MAX; v++) {
            uint8 mult = gm[v];
            if (mult == 0) continue;
            // count occurrences of value v in the encrypted secret
            euint8 sc = FHE.asEuint8(0);
            for (uint256 i = 0; i < CODE_LEN; i++) {
                sc = FHE.add(sc, _toU8(FHE.eq(g.secret[i], v)));
            }
            // min(secretCount, guessMultiplicity) — the classic white+black contribution
            euint8 capped = FHE.min(sc, FHE.asEuint8(mult));
            total = FHE.add(total, capped);
        }
        euint8 white = FHE.sub(total, black);

        // ---- solved flag ----
        euint8 solved = _toU8(FHE.eq(black, CODE_LEN));

        // ---- persist + grant decryption rights to the guesser only ----
        uint32 idx = ++g.guessCount;
        Feedback storage fb = _feedback[gameId][msg.sender];
        fb.black = black;
        fb.white = white;
        fb.solved = solved;
        fb.guessIndex = idx;
        fb.exists = true;

        FHE.allowThis(black);
        FHE.allowThis(white);
        FHE.allowThis(solved);
        FHE.allow(black, msg.sender);
        FHE.allow(white, msg.sender);
        FHE.allow(solved, msg.sender);

        emit GuessSubmitted(gameId, msg.sender, idx, guess);
    }

    /**
     * Setter closes the game (e.g. after the round ends). Does not move funds —
     * staking lives in CrackdDuel / CrackdVault.
     */
    function closeGame(bytes32 gameId) external {
        Game storage g = _games[gameId];
        if (g.setter != msg.sender) revert NotSetter();
        g.status = GameStatus.Closed;
        emit GameClosed(gameId);
    }

    // ----------------------------- reads ---------------------------------

    function getStatus(bytes32 gameId) external view returns (GameStatus) {
        return _games[gameId].status;
    }

    function getSetter(bytes32 gameId) external view returns (address) {
        return _games[gameId].setter;
    }

    function getGuessCount(bytes32 gameId) external view returns (uint32) {
        return _games[gameId].guessCount;
    }

    /**
     * Latest feedback handles for `guesser`. The returned euint8 handles are
     * decryptable by `guesser` through the relayer user-decryption flow.
     */
    function getFeedback(
        bytes32 gameId,
        address guesser
    ) external view returns (euint8 black, euint8 white, euint8 solved, uint32 guessIndex) {
        Feedback storage fb = _feedback[gameId][guesser];
        return (fb.black, fb.white, fb.solved, fb.guessIndex);
    }

    // ----------------------------- helpers -------------------------------

    /// Cast an encrypted boolean to a 0/1 encrypted uint8.
    function _toU8(ebool b) private returns (euint8) {
        return FHE.select(b, FHE.asEuint8(1), FHE.asEuint8(0));
    }
}
