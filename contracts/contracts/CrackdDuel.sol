// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * CrackdDuel — multi-asset PvP escrow for 1v1 staked matches.
 *
 * EVM port of the Soroban duel contract. Each duel carries its own ERC-20
 * asset, picked at create time; player two must match it on join (read from
 * storage, never a parameter, so mismatches are impossible).
 *
 * State machine: Waiting → Active → Completed | Refunded | Expired.
 *
 * The off-chain orchestrator (backend admin key = contract owner) referees the
 * actual code-breaking and calls declareWinner / declareDraw. Funds only ever
 * move via the contract; the owner can never mint a payout that wasn't staked.
 *
 * NOTE: ERC-20 escrow requires the staker to `approve` this contract for the
 * stake amount before calling create/join (unlike Soroban's auth-based pull).
 */
contract CrackdDuel is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------- constants -----------------------------

    uint256 public constant PROTOCOL_FEE_BPS = 250; // 2.5%
    uint256 private constant BPS_DENOM = 10_000;
    uint64 public constant GAME_TIMEOUT_SECS = 3600;

    /// Minimum stake, in the token's smallest unit. Owner-tunable because
    /// ERC-20 decimals vary by asset (Soroban SACs were uniformly 7-dp).
    uint256 public minStake;

    // ----------------------------- types ---------------------------------

    enum GameStatus {
        None, // 0
        Waiting, // 1
        Active, // 2
        Completed, // 3
        Refunded, // 4
        Expired // 5
    }

    struct GameSession {
        bytes32 gameId;
        address playerOne;
        address playerTwo; // address(0) until joined
        address token;
        uint256 stakeAmount;
        GameStatus status;
        uint64 createdAt;
        address winner; // address(0) until resolved
        uint256 payout; // 0 until resolved
    }

    // ----------------------------- storage -------------------------------

    mapping(bytes32 => GameSession) private _games;
    mapping(address => bytes32[]) private _playerGames;
    mapping(address => uint256) private _treasury; // accrued fees per token
    mapping(address => uint256) private _nonce; // per-player entropy

    // ----------------------------- events --------------------------------

    event GameCreated(bytes32 indexed gameId, address indexed playerOne, address indexed token, uint256 stake);
    event GameJoined(bytes32 indexed gameId, address indexed playerTwo);
    event GameCancelled(bytes32 indexed gameId);
    event GameExpired(bytes32 indexed gameId);
    event WinnerDeclared(bytes32 indexed gameId, address indexed token, address indexed winner, uint256 payout, uint256 fee);
    event DrawDeclared(bytes32 indexed gameId);

    // ----------------------------- errors --------------------------------

    error BelowMinimumStake();
    error GameNotFound();
    error GameNotWaiting();
    error GameNotActive();
    error SamePlayer();
    error AlreadyExpired();
    error NotTimedOutYet();
    error Unauthorized();
    error InvalidWinner();
    error InvalidAmount();

    constructor(address admin, uint256 minStake_) Ownable(admin) {
        minStake = minStake_;
    }

    function setMinStake(uint256 newMin) external onlyOwner {
        minStake = newMin;
    }

    // ----------------------------- player actions ------------------------

    /// Player one creates a game with a chosen asset + stake.
    function createGame(address token, uint256 stake) external nonReentrant returns (bytes32 gameId) {
        if (stake < minStake) revert BelowMinimumStake();

        IERC20(token).safeTransferFrom(msg.sender, address(this), stake);

        gameId = keccak256(abi.encodePacked(msg.sender, _nonce[msg.sender]++));
        _games[gameId] = GameSession({
            gameId: gameId,
            playerOne: msg.sender,
            playerTwo: address(0),
            token: token,
            stakeAmount: stake,
            status: GameStatus.Waiting,
            createdAt: uint64(block.timestamp),
            winner: address(0),
            payout: 0
        });
        _playerGames[msg.sender].push(gameId);

        emit GameCreated(gameId, msg.sender, token, stake);
    }

    /// Player two joins by matching the stored stake/asset.
    function joinGame(bytes32 gameId) external nonReentrant {
        GameSession storage game = _games[gameId];
        if (game.status == GameStatus.None) revert GameNotFound();
        if (game.status != GameStatus.Waiting) revert GameNotWaiting();
        if (msg.sender == game.playerOne) revert SamePlayer();
        if (block.timestamp > game.createdAt + GAME_TIMEOUT_SECS) revert AlreadyExpired();

        IERC20(game.token).safeTransferFrom(msg.sender, address(this), game.stakeAmount);

        game.playerTwo = msg.sender;
        game.status = GameStatus.Active;
        _playerGames[msg.sender].push(gameId);

        emit GameJoined(gameId, msg.sender);
    }

    /// Cancel a waiting game (player one or owner), refunding player one.
    function cancelGame(bytes32 gameId) external nonReentrant {
        GameSession storage game = _games[gameId];
        if (game.status == GameStatus.None) revert GameNotFound();
        if (game.status != GameStatus.Waiting) revert GameNotWaiting();
        if (msg.sender != game.playerOne && msg.sender != owner()) revert Unauthorized();

        game.status = GameStatus.Refunded;
        IERC20(game.token).safeTransfer(game.playerOne, game.stakeAmount);

        emit GameCancelled(gameId);
    }

    /// Anyone can expire a stale waiting game past the timeout; refunds p1.
    function expireGame(bytes32 gameId) external nonReentrant {
        GameSession storage game = _games[gameId];
        if (game.status == GameStatus.None) revert GameNotFound();
        if (game.status != GameStatus.Waiting) revert GameNotWaiting();
        if (block.timestamp <= game.createdAt + GAME_TIMEOUT_SECS) revert NotTimedOutYet();

        game.status = GameStatus.Expired;
        IERC20(game.token).safeTransfer(game.playerOne, game.stakeAmount);

        emit GameExpired(gameId);
    }

    // ----------------------------- owner resolution ----------------------

    function declareWinner(bytes32 gameId, address winner) external onlyOwner nonReentrant {
        GameSession storage game = _games[gameId];
        if (game.status != GameStatus.Active) revert GameNotActive();
        if (winner != game.playerOne && winner != game.playerTwo) revert InvalidWinner();

        uint256 pot = game.stakeAmount * 2;
        uint256 fee = (pot * PROTOCOL_FEE_BPS) / BPS_DENOM;
        uint256 payout = pot - fee;

        game.status = GameStatus.Completed;
        game.winner = winner;
        game.payout = payout;
        _treasury[game.token] += fee;

        IERC20(game.token).safeTransfer(winner, payout);

        emit WinnerDeclared(gameId, game.token, winner, payout, fee);
    }

    function declareDraw(bytes32 gameId) external onlyOwner nonReentrant {
        GameSession storage game = _games[gameId];
        if (game.status != GameStatus.Active) revert GameNotActive();

        game.status = GameStatus.Refunded;
        IERC20(game.token).safeTransfer(game.playerOne, game.stakeAmount);
        IERC20(game.token).safeTransfer(game.playerTwo, game.stakeAmount);

        emit DrawDeclared(gameId);
    }

    function withdrawTreasury(address token, uint256 amount, address recipient) external onlyOwner nonReentrant {
        if (amount == 0 || amount > _treasury[token]) revert InvalidAmount();
        _treasury[token] -= amount;
        IERC20(token).safeTransfer(recipient, amount);
    }

    // ----------------------------- reads ---------------------------------

    function getGame(bytes32 gameId) external view returns (GameSession memory) {
        GameSession memory game = _games[gameId];
        if (game.status == GameStatus.None) revert GameNotFound();
        return game;
    }

    function getPlayerGames(address player) external view returns (bytes32[] memory) {
        return _playerGames[player];
    }

    function getTreasuryBalance(address token) external view returns (uint256) {
        return _treasury[token];
    }
}
