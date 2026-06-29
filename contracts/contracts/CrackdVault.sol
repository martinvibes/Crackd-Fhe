// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * CrackdVault — multi-asset community prize-pool contract for vs-AI games.
 *
 * EVM port of the Soroban vault. One instance serves any number of ERC-20
 * assets; each asset has its own pool, 24h daily-cap window and leaderboard.
 * Gameplay stats (wins/losses/streaks) are denomination-agnostic per player.
 *
 * Flow (vs-AI staked):
 *  1. Player approves + calls stake(token, amount) → asset enters the pool.
 *  2. Game plays out off-chain (the Crackd backend referees).
 *  3. Owner calls resolveWin(player, token, stake, guessesUsed) → pays
 *     stake + bonus, capped at 25% of that asset's pool per player per 24h;
 *     or resolveLoss(player) → stake stays in the pool.
 */
contract CrackdVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant LEADERBOARD_SIZE = 10;
    uint64 public constant ONE_DAY_SECS = 86_400;
    uint256 private constant BPS_DENOM = 10_000;

    struct PlayerStats {
        uint32 wins;
        uint32 losses;
        uint32 bestStreak;
        uint32 currentStreak;
        uint32 gamesPlayed;
    }

    struct LeaderboardEntry {
        address player;
        uint256 totalEarned;
        uint32 wins;
        uint32 bestStreak;
    }

    // token => pool balance
    mapping(address => uint256) private _pool;
    // token => last daily-window reset timestamp
    mapping(address => uint64) private _lastReset;
    // token => player => winnings in the current day window
    mapping(address => mapping(address => uint256)) private _dailyWon;
    // token => player => the _lastReset value at which _dailyWon was recorded.
    // If it lags the token's current _lastReset, the winnings are stale → 0.
    // (Replaces Soroban's temp-storage TTL self-expiry.)
    mapping(address => mapping(address => uint64)) private _wonWindow;
    // player => unified stats
    mapping(address => PlayerStats) private _stats;
    // player => token => cumulative earnings (bonus only)
    mapping(address => mapping(address => uint256)) private _earned;
    // token => leaderboard addresses (top-N by earnings in that asset)
    mapping(address => address[]) private _leaderboard;
    mapping(address => mapping(address => bool)) private _onBoard; // token => player => present

    event Initialized(address indexed admin);
    event PoolToppedUp(address indexed token, address indexed from, uint256 amount, uint256 newBalance);
    event Staked(address indexed token, address indexed player, uint256 amount, uint256 newBalance);
    event Loss(address indexed player);
    event Payout(address indexed token, address indexed player, uint256 stake, uint256 bonus, uint32 guessesUsed);
    event DailyReset(address indexed token, uint64 at);

    error InvalidAmount();
    error InvalidStake();
    error InvalidGuessCount();
    error DailyCapReached();
    error InsufficientPool();

    constructor(address admin) Ownable(admin) {
        emit Initialized(admin);
    }

    // ----------------------------- admin ---------------------------------

    function adminDeposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _pool[token] += amount;
        if (_lastReset[token] == 0) _lastReset[token] = uint64(block.timestamp);
        emit PoolToppedUp(token, msg.sender, amount, _pool[token]);
    }

    // ----------------------------- staking -------------------------------

    function stake(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidStake();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _pool[token] += amount;
        if (_lastReset[token] == 0) _lastReset[token] = uint64(block.timestamp);
        emit Staked(token, msg.sender, amount, _pool[token]);
    }

    // ----------------------------- resolution ----------------------------

    function resolveLoss(address player) external onlyOwner {
        PlayerStats storage s = _stats[player];
        s.losses += 1;
        s.currentStreak = 0;
        s.gamesPlayed += 1;
        emit Loss(player);
    }

    /// Records a win for `token` and pays stake + bonus (bonus clamped by the
    /// 25% daily cap). Returns the bonus paid.
    function resolveWin(
        address player,
        address token,
        uint256 stakeAmount,
        uint32 guessesUsed
    ) external onlyOwner nonReentrant returns (uint256 bonus) {
        if (stakeAmount == 0) revert InvalidStake();
        if (guessesUsed == 0) revert InvalidGuessCount();

        _maybeRollDailyWindow(token);

        uint256 desired = _grossPayout(stakeAmount, guessesUsed);
        uint256 pool = _pool[token];
        uint256 alreadyWon = _effectiveDailyWon(token, player);

        uint256 cap = pool / 4;
        if (alreadyWon >= cap) revert DailyCapReached();
        uint256 remaining = cap - alreadyWon;
        bonus = desired < remaining ? desired : remaining;
        if (bonus == 0) revert DailyCapReached();

        if (pool < stakeAmount + bonus) revert InsufficientPool();

        _pool[token] = pool - bonus - stakeAmount;
        _dailyWon[token][player] = alreadyWon + bonus;
        _wonWindow[token][player] = _lastReset[token];

        IERC20(token).safeTransfer(player, stakeAmount + bonus);

        PlayerStats storage s = _stats[player];
        s.wins += 1;
        s.gamesPlayed += 1;
        s.currentStreak += 1;
        if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak;

        _earned[player][token] += bonus;
        _updateLeaderboard(token, player);

        emit Payout(token, player, stakeAmount, bonus, guessesUsed);
    }

    // ----------------------------- reads ---------------------------------

    function getPoolBalance(address token) external view returns (uint256) {
        return _pool[token];
    }

    function getPlayerStats(address player) external view returns (PlayerStats memory) {
        return _stats[player];
    }

    function getPlayerEarned(address player, address token) external view returns (uint256) {
        return _earned[player][token];
    }

    function getDailyRemaining(address player, address token) external view returns (uint256) {
        uint256 cap = _pool[token] / 4;
        uint256 won = _effectiveDailyWon(token, player);
        return won >= cap ? 0 : cap - won;
    }

    /// Window-aware read of a player's winnings: zero once the token's daily
    /// window has rolled past the window in which they were last recorded.
    function _effectiveDailyWon(address token, address player) private view returns (uint256) {
        if (_wonWindow[token][player] != _lastReset[token]) return 0;
        return _dailyWon[token][player];
    }

    function getLeaderboard(address token) external view returns (LeaderboardEntry[] memory) {
        address[] storage addrs = _leaderboard[token];
        LeaderboardEntry[] memory out = new LeaderboardEntry[](addrs.length);
        for (uint256 i = 0; i < addrs.length; i++) {
            PlayerStats storage s = _stats[addrs[i]];
            out[i] = LeaderboardEntry({
                player: addrs[i],
                totalEarned: _earned[addrs[i]][token],
                wins: s.wins,
                bestStreak: s.bestStreak
            });
        }
        return out;
    }

    // ----------------------------- internals -----------------------------

    /// Reward multiplier in bps by guesses used. Every winner at least doubles
    /// their stake (1.0× bonus); fast crackers get a little more.
    function _multiplierBps(uint32 guessesUsed) private pure returns (uint256) {
        if (guessesUsed == 0) return 0;
        if (guessesUsed <= 3) return 15_000;
        if (guessesUsed <= 5) return 12_500;
        return 10_000;
    }

    function _grossPayout(uint256 stakeAmount, uint32 guessesUsed) private pure returns (uint256) {
        return (stakeAmount * _multiplierBps(guessesUsed)) / BPS_DENOM;
    }

    function _maybeRollDailyWindow(address token) private {
        uint64 last = _lastReset[token];
        if (block.timestamp >= last + ONE_DAY_SECS) {
            _lastReset[token] = uint64(block.timestamp);
            // Note: per-player day counters are lazily overwritten on next win;
            // we additionally gate via the window reset event for observers.
            emit DailyReset(token, uint64(block.timestamp));
        }
    }

    /// Insert the player (if new) and re-rank by earnings-in-that-asset desc,
    /// capped at LEADERBOARD_SIZE. N is tiny so a selection pass is fine.
    function _updateLeaderboard(address token, address player) private {
        address[] storage board = _leaderboard[token];
        if (!_onBoard[token][player]) {
            board.push(player);
            _onBoard[token][player] = true;
        }

        // selection sort descending by earnings
        uint256 n = board.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 best = i;
            for (uint256 j = i + 1; j < n; j++) {
                if (_earned[board[j]][token] > _earned[board[best]][token]) best = j;
            }
            if (best != i) {
                (board[i], board[best]) = (board[best], board[i]);
            }
        }

        // trim to LEADERBOARD_SIZE, dropping the evicted player's flag
        while (board.length > LEADERBOARD_SIZE) {
            address dropped = board[board.length - 1];
            _onBoard[token][dropped] = false;
            board.pop();
        }
    }
}
