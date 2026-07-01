/**
 * Game page — pure orchestrator.
 *
 * State machine:
 *   mode_pick → setup → lobby → setting_codes → active → finished
 *
 * Backend owns authoritative game state; we render the `view` blob we
 * receive over the socket. Player-initiated socket events are emitted
 * via `useGameSocket`. Staked contract calls are self-submitted by the
 * player via `lib/evm` (ethers) using the active wallet's Signer; once a
 * tx confirms we notify the backend with { address, txHash, ... }.
 *
 * Every stage's UI lives in a small file under `components/game/`. This
 * file is deliberately thin — it only decides *which* panel to show
 * and handles the create/join transaction plumbing.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWalletStore } from "../store/walletStore";
import { useGameStore } from "../store/gameStore";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  emitCancelGame,
  emitChat,
  emitCreateGame,
  emitJoinGame,
  emitMakeGuess,
  emitSetCode,
  useGameSocket,
} from "../hooks/useGameSocket";
import {
  duelCreateGame,
  duelJoinGame,
  vaultStake,
  toBaseUnits,
} from "../lib/evm";
import { getActiveProvider } from "../lib/wallet";

import { ErrorBar } from "../components/game/ErrorBar";
import { PlayBackground } from "../components/game/PlayBackground";
import { ModePicker, type Mode } from "../components/game/ModePicker";
import { SetupPanel } from "../components/game/SetupPanel";
import { LobbyPanel } from "../components/game/LobbyPanel";
import { Board } from "../components/game/board/Board";
import { FinishedPanel } from "../components/game/FinishedPanel";
import { ChatDock } from "../components/game/ChatDock";
import { HelpDock } from "../components/game/HelpDock";

type Stage =
  | "mode_pick"
  | "setup"
  | "lobby"
  | "setting_codes"
  | "active"
  | "finished";

/**
 * Snapshot of an invite's underlying game, surfaced to the joiner so
 * they can see what they're agreeing to BEFORE the wallet prompts.
 * Populated by a debounced fetch off `GET /api/game/:gameId`.
 */
export type JoinPreview = {
  gameId: string;
  mode: Mode;
  status: "lobby" | "setting_codes" | "active" | "finished" | "cancelled";
  playerOne: string;
  /** Whole-asset units (e.g. WETH). 0 for casual games. */
  stake: number;
  stakeAsset: string | null;
  contractGameId: string | null;
};

export default function Game() {
  useGameSocket(); // attach socket listeners to the store

  const [sp, setSp] = useSearchParams();
  const modeParam = sp.get("mode") as Mode | null;
  const inviteParam = sp.get("invite");
  const navigate = useNavigate();

  const { address } = useWalletStore();
  const view = useGameStore((s) => s.view);
  const finished = useGameStore((s) => s.finished);
  const reset = useGameStore((s) => s.reset);
  const tauntLine = useGameStore((s) => s.tauntLine);

  const assetsQ = useQuery({ queryKey: ["assets"], queryFn: () => api.assets() });

  const [mode, setMode] = useState<Mode | null>(modeParam);
  const [gameId, setGameId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [joinInviteInput, setJoinInviteInput] = useState(inviteParam ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joinPreview, setJoinPreview] = useState<JoinPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Clear store on unmount.
  useEffect(() => () => reset(), [reset]);

  // Keep mode state in sync with URL so browser back works naturally.
  useEffect(() => {
    setMode(modeParam);
  }, [modeParam]);

  // Live preview: when the joiner pastes an invite, fetch the game so
  // we can show "this is a staked match — 1 WETH, winner takes 1.95"
  // BEFORE the wallet prompts. Debounced so we don't hit the API on
  // every keystroke. Cancellable so a fast typer doesn't see stale data.
  useEffect(() => {
    const trimmed = joinInviteInput.trim();
    if (!trimmed || trimmed.length < 6) {
      setJoinPreview(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const full = await lookupGameIdFromInvite(trimmed);
        if (cancelled || !full) {
          if (!cancelled) setJoinPreview(null);
          return;
        }
        const gs = (await api.game(full)) as Partial<JoinPreview> & {
          gameId?: string;
        };
        if (cancelled) return;
        setJoinPreview({
          gameId: gs.gameId ?? full,
          mode: (gs.mode as Mode) ?? "pvp_casual",
          status: (gs.status as JoinPreview["status"]) ?? "lobby",
          playerOne: gs.playerOne ?? "",
          stake: typeof gs.stake === "number" ? gs.stake : 0,
          stakeAsset: gs.stakeAsset ?? null,
          contractGameId: gs.contractGameId ?? null,
        });
      } catch {
        if (!cancelled) setJoinPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [joinInviteInput]);

  function goBackToModePicker() {
    reset();
    setGameId(null);
    setInviteCode(null);
    setMode(null);
    setSp({});
  }

  const stage: Stage = useMemo(() => {
    if (finished) return "finished";
    if (!mode) return "mode_pick";
    if (!gameId) return "setup";
    if (!view) return "lobby";
    if (view.status === "lobby") return "lobby";
    if (view.status === "setting_codes") return "setting_codes";
    if (view.status === "active") return "active";
    if (view.status === "finished") return "finished";
    return "lobby";
  }, [mode, gameId, view, finished]);

  // -------------- actions --------------

  async function handleCreate(asset?: string, stakeAmount?: number) {
    if (!mode) return;
    setBusy(true);
    setErr(null);
    try {
      const wallet = address ?? generateAnon();

      let txHash: string | undefined;
      let contractGameId: string | undefined;
      let stakeBaseUnits: string | undefined;
      if (mode === "vs_ai_staked" || mode === "pvp_staked") {
        if (!address) throw new Error("Sign in to stake");
        const chosen = assetsQ.data?.assets.find((a) => a.symbol === asset);
        if (!chosen) throw new Error("Pick an asset");
        const token = tokenAddress(chosen.symbol);
        if (!token) throw new Error(`No token address for ${chosen.symbol}`);
        const amount = toBaseUnits(stakeAmount ?? 0, chosen.decimals);
        stakeBaseUnits = amount.toString();
        const provider = await getActiveProvider();
        const signer = await provider.getSigner();
        if (mode === "vs_ai_staked") {
          const res = await vaultStake(signer, token, amount);
          txHash = res.txHash;
        } else {
          const res = await duelCreateGame(signer, token, amount);
          txHash = res.txHash;
          contractGameId = res.gameId;
        }
      }

      const ack = await emitCreateGame({
        walletAddress: wallet,
        mode,
        asset,
        stakeBaseUnits,
        txHash,
        contractGameId,
      });
      if (ack.error || !ack.gameId) throw new Error(ack.error || "create failed");
      setGameId(ack.gameId);
      setInviteCode(ack.gameId.slice(-6).toUpperCase());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(invite: string) {
    if (!mode) return;
    setBusy(true);
    setErr(null);
    try {
      const full = await lookupGameIdFromInvite(invite);
      if (!full) throw new Error("Invite not found");

      // Reuse the live preview if it matches; otherwise fall back to a
      // fresh fetch. Either way we use the game's ACTUAL mode, not the
      // mode in the URL — invite redirects always set mode=pvp_casual.
      const gs =
        joinPreview && joinPreview.gameId === full
          ? joinPreview
          : ((await api.game(full)) as {
              mode?: Mode;
              contractGameId?: string | null;
              stake?: number;
              stakeAsset?: string | null;
            });
      const realMode = (gs.mode as Mode | undefined) ?? mode;

      const wallet = address ?? generateAnon();
      let txHash: string | undefined;

      if (realMode === "pvp_staked") {
        if (!address) throw new Error("Sign in to join a staked match");
        if (!gs.contractGameId) throw new Error("Contract game id missing");
        const symbol = gs.stakeAsset ?? "WETH";
        const chosen = assetsQ.data?.assets.find((a) => a.symbol === symbol);
        const token = tokenAddress(symbol);
        const amount =
          gs.stake !== undefined && gs.stake !== null
            ? toBaseUnits(gs.stake, chosen?.decimals ?? 18)
            : undefined;
        const provider = await getActiveProvider();
        const signer = await provider.getSigner();
        const res = await duelJoinGame(
          signer,
          gs.contractGameId,
          token ?? undefined,
          amount,
        );
        txHash = res.txHash;
      }

      const ack = await emitJoinGame({ gameId: full, walletAddress: wallet, txHash });
      if (!ack.ok) throw new Error(ack.error || "join failed");

      // Sync local mode + URL with the game's real mode so the rest of
      // the page renders correctly (board header, finished panel, etc).
      if (realMode !== mode) {
        setMode(realMode);
        setSp({ mode: realMode, invite });
      }
      setGameId(full);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // -------------- render --------------

  const compact = stage === "active" || stage === "setting_codes";
  return (
    <div
      className={`max-w-5xl mx-auto px-5 md:px-8 ${
        compact ? "py-3" : "py-10 md:py-16"
      }`}
    >
      <PlayBackground intense={stage === "active"} />
      <div className="relative z-10">
      {err && <ErrorBar message={err} onClose={() => setErr(null)} />}

      {stage === "mode_pick" && (
        <ModePicker
          onPick={(m) => {
            setMode(m);
            setSp({ mode: m });
          }}
        />
      )}

      {stage === "setup" && mode && (
        <SetupPanel
          mode={mode}
          assets={assetsQ.data?.assets ?? []}
          busy={busy}
          walletConnected={!!address}
          invitePrefill={joinInviteInput}
          onInviteChange={setJoinInviteInput}
          onCreate={handleCreate}
          onJoin={handleJoin}
          onBack={goBackToModePicker}
          joinPreview={joinPreview}
          previewLoading={previewLoading}
        />
      )}

      {stage === "lobby" && mode && gameId && (
        <LobbyPanel
          inviteCode={inviteCode ?? gameId.slice(-6).toUpperCase()}
          mode={mode}
          onCancel={async () => {
            const wallet = address ?? "";
            await emitCancelGame({ gameId, walletAddress: wallet });
            setGameId(null);
            setInviteCode(null);
            setMode(null);
            navigate("/play");
          }}
        />
      )}

      {(stage === "setting_codes" || stage === "active") && gameId && view && (
        <>
          <Board
            walletAddress={(address ?? view.youAre) as string}
            view={view}
            tauntLine={tauntLine}
            onSetCode={(code) =>
              emitSetCode({
                gameId,
                walletAddress: (address ?? view.youAre) as string,
                code,
              })
            }
            onGuess={(guess) =>
              emitMakeGuess({
                gameId,
                walletAddress: (address ?? view.youAre) as string,
                guess,
              })
            }
          />
          <ChatDock
            onSend={(message) =>
              emitChat({
                gameId,
                walletAddress: (address ?? view.youAre) as string,
                message,
              })
            }
          />
        </>
      )}

      {stage === "finished" && finished && (
        <FinishedPanel
          finished={finished}
          me={address ?? (view?.youAre as string | undefined)}
          onPlayAgain={goBackToModePicker}
        />
      )}

      {/* Always-on floating help — newcomers can open the worked
          example from any stage of /play without cluttering any panel. */}
      <HelpDock />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Tiny helpers kept in this file because they're only used here.
// ------------------------------------------------------------

/** Resolve an asset symbol to its ERC20 contract address from env. */
function tokenAddress(symbol: string): string | null {
  switch (symbol.toUpperCase()) {
    case "WETH":
      return (import.meta.env.VITE_WETH_ADDRESS as string) || null;
    case "USDC":
      return (import.meta.env.VITE_USDC_ADDRESS as string) || null;
    default:
      return null;
  }
}

/**
 * Casual / free modes let users play without a wallet. We still need a
 * stable id per tab so the backend can assign them to a slot; a random
 * 0x-prefixed hex string is enough (not a real key/address).
 */
function generateAnon(): string {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * hex.length)];
  return s;
}

/**
 * Resolve either a full UUID or a 6-character invite code to a real
 * gameId. Short codes go through the backend `/api/invite/:code`
 * mapping that's written at create_game time.
 */
async function lookupGameIdFromInvite(invite: string): Promise<string | null> {
  const trimmed = invite.trim();
  if (!trimmed) return null;
  if (trimmed.length > 20) return trimmed; // looks like a full uuid
  try {
    const { gameId } = await api.resolveInvite(trimmed);
    return gameId;
  } catch {
    return null;
  }
}
