"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mode,
  TIME_CONTROLS,
  TimeControlPreset,
  Color,
  type ClientGameMessage,
  type GameResult,
  type MoveRecord,
  type OpponentInfo,
  type ServerGameMessage,
  type Termination,
  type TimeControl,
} from "@chesstalk/shared";
import { Clock } from "../../components/clock.tsx";
import { GameBoard } from "../../components/game-board.tsx";
import { MoveList } from "../../components/move-list.tsx";
import { VoiceCapsule } from "../../components/voice-capsule.tsx";
import { useAudioSocket } from "../../hooks/use-audio-socket.ts";
import { useClock, type ClockSnapshot } from "../../hooks/use-clock.ts";
import { useGameSocket } from "../../hooks/use-game-socket.ts";
import { useMicStream } from "../../hooks/use-mic-stream.ts";
import { useVoiceRecorder } from "../../hooks/use-voice-recorder.ts";

type InviteClientMessage =
  | { type: "invite:create"; mode: Mode; timeControl: TimeControl }
  | { type: "invite:join"; inviteId: string };

type BotClientMessage = {
  type: "bot:start";
  mode: Mode;
  timeControl: TimeControl;
  side?: Color;
  strength?: number;
};

type InviteServerMessage =
  | { type: "invite:waiting"; inviteId?: string; id?: string }
  | { type: "invite:not_found"; inviteId?: string; id?: string };

type IncomingGameMessage = ServerGameMessage | InviteServerMessage;

type InviteState =
  | { status: "idle"; url: null; error: null }
  | { status: "creating"; url: null; error: null }
  | { status: "ready"; url: string; error: null }
  | { status: "joining"; url: null; error: null }
  | { status: "error"; url: string | null; error: string };

type SetupPanel = "regular" | "bot";

type Phase =
  | { kind: "pre" }
  | {
      kind: "queueing";
      mode: Mode;
      timeControl: TimeControl;
      queueDepth: number;
      totalQueueDepth: number;
    }
  | {
      kind: "in-game";
      gameId: string;
      color: Color;
      opponent: OpponentInfo;
      mode: Mode;
      fen: string;
      turn: Color;
      moves: MoveRecord[];
      snapshot: ClockSnapshot;
      lastError: string | null;
      illegalCount: number;
      opponentDisconnectedUntil: number | null;
    }
  | {
      kind: "ended";
      gameId: string;
      mode: Mode;
      result: GameResult;
      termination: Termination;
      ratingDeltaSelf: number;
      yourColor: Color;
    };

const TIME_CONTROL_OPTIONS: Array<{ preset: TimeControlPreset; label: string }> = [
  { preset: TimeControlPreset.Blitz5, label: "5+0" },
  { preset: TimeControlPreset.Rapid10, label: "10+0" },
];

const MODE_OPTIONS: Array<{ value: Mode; label: string; description: string }> = [
  { value: Mode.Easy, label: "Easy", description: "Board visible" },
  { value: Mode.Blindfold, label: "Blindfold", description: "No board" },
];

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const ACTIVE_GAME_STORAGE_KEY = "chesstalk:activeGameId";

function formatResult(result: GameResult, yourColor: Color): "Win" | "Loss" | "Draw" {
  if (result === "draw") return "Draw";
  return result === yourColor ? "Win" : "Loss";
}

function describeTermination(t: Termination): string {
  switch (t) {
    case "checkmate":
      return "Checkmate";
    case "resignation":
      return "Resignation";
    case "timeout":
      return "Timeout";
    case "illegal_strikes":
      return "Illegal move strikes";
    case "disconnect":
      return "Disconnected";
    case "draw_stalemate":
      return "Stalemate";
    case "draw_threefold":
      return "Threefold repetition";
    case "draw_fifty":
      return "50-move rule";
    case "draw_material":
      return "Insufficient material";
    case "draw_agreed":
      return "Draw agreed";
    default:
      return t;
  }
}

function sendInvite(
  send: (msg: ClientGameMessage) => void,
  msg: InviteClientMessage,
): void {
  send(msg as unknown as ClientGameMessage);
}

function sendBot(send: (msg: ClientGameMessage) => void, msg: BotClientMessage): void {
  send(msg as unknown as ClientGameMessage);
}

function buildInviteUrl(inviteId: string): string {
  if (typeof window === "undefined") return `/play?invite=${encodeURIComponent(inviteId)}`;
  const url = new URL("/play", window.location.origin);
  url.searchParams.set("invite", inviteId);
  return url.toString();
}

export default function PlayPage() {
  return (
    <Suspense fallback={<PlayPageFallback />}>
      <PlayClient />
    </Suspense>
  );
}

function PlayPageFallback() {
  return (
    <section className="rounded bg-[#262421] p-8 text-center text-[#9b948a]">
      Loading play screen...
    </section>
  );
}

function PlayClient() {
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("invite")?.trim() ?? "";
  const hasJoinedInviteRef = useRef(false);
  const hasAttemptedResumeRef = useRef(false);
  const { status, send, subscribe } = useGameSocket();
  const [phase, setPhase] = useState<Phase>({ kind: "pre" });
  const [selectedMode, setSelectedMode] = useState<Mode>(Mode.Easy);
  const [selectedPreset, setSelectedPreset] = useState<TimeControlPreset>(
    TimeControlPreset.Blitz5,
  );
  const [moveInput, setMoveInput] = useState("");
  const [botSide, setBotSide] = useState<Color>(Color.White);
  const [botStrength, setBotStrength] = useState(5);
  const [setupPanel, setSetupPanel] = useState<SetupPanel>("regular");
  const [invite, setInvite] = useState<InviteState>({
    status: "idle",
    url: null,
    error: null,
  });

  useEffect(() => {
    const unsub = subscribe((msg: ServerGameMessage) => {
      const incoming = msg as IncomingGameMessage;
      if (incoming.type === "invite:created" || incoming.type === "invite:waiting") {
        const createdInviteId =
          incoming.inviteId ?? ("id" in incoming ? incoming.id : null) ?? null;
        if (!createdInviteId) {
          setInvite({
            status: "error",
            url: null,
            error: "Server did not return an invite id.",
          });
          return;
        }
        setInvite({
          status: "ready",
          url: buildInviteUrl(createdInviteId),
          error: null,
        });
        return;
      }

      if (incoming.type === "invite:not_found") {
        setInvite({
          status: "error",
          url: null,
          error: "That invite was not found or has expired.",
        });
        return;
      }

      if (incoming.type === "error") {
        if (
          "code" in incoming &&
          incoming.code === "game_not_found" &&
          typeof window !== "undefined"
        ) {
          sessionStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
        }
        setInvite((current) => {
          if (current.status !== "creating" && current.status !== "joining") {
            return current;
          }
          return {
            status: "error",
            url: current.url,
            error: incoming.message,
          };
        });
      }

      setPhase((current) => reducePhase(current, incoming));
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    if (status !== "open" || !inviteId || hasJoinedInviteRef.current) return;
    hasJoinedInviteRef.current = true;
    setInvite({ status: "joining", url: null, error: null });
    sendInvite(send, { type: "invite:join", inviteId });
  }, [inviteId, send, status]);

  const activeGameId = phase.kind === "in-game" ? phase.gameId : null;
  useEffect(() => {
    if (status !== "open" || activeGameId === null) return;
    send({ type: "game:resume", gameId: activeGameId });
  }, [activeGameId, send, status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (phase.kind === "in-game") {
      sessionStorage.setItem(ACTIVE_GAME_STORAGE_KEY, phase.gameId);
    } else if (phase.kind === "pre" || phase.kind === "ended") {
      sessionStorage.removeItem(ACTIVE_GAME_STORAGE_KEY);
    }
  }, [phase]);

  useEffect(() => {
    if (status !== "open") return;
    if (phase.kind !== "pre") return;
    if (hasAttemptedResumeRef.current) return;
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
    if (!stored) return;
    hasAttemptedResumeRef.current = true;
    send({ type: "game:resume", gameId: stored });
  }, [phase.kind, send, status]);

  const startQueue = useCallback((): void => {
    const timeControl = TIME_CONTROLS[selectedPreset];
    setPhase({
      kind: "queueing",
      mode: selectedMode,
      timeControl,
      queueDepth: 0,
      totalQueueDepth: 0,
    });
    send({ type: "queue:join", mode: selectedMode, timeControl });
  }, [selectedMode, selectedPreset, send]);

  const cancelQueue = useCallback((): void => {
    send({ type: "queue:leave" });
    setPhase({ kind: "pre" });
  }, [send]);

  const createInvite = useCallback((): void => {
    const timeControl = TIME_CONTROLS[selectedPreset];
    setInvite({ status: "creating", url: null, error: null });
    sendInvite(send, { type: "invite:create", mode: selectedMode, timeControl });
  }, [selectedMode, selectedPreset, send]);

  const startBot = useCallback((): void => {
    const timeControl = TIME_CONTROLS[selectedPreset];
    sendBot(send, {
      type: "bot:start",
      mode: selectedMode,
      timeControl,
      side: botSide,
      strength: botStrength,
    });
  }, [botSide, botStrength, selectedMode, selectedPreset, send]);

  const resign = useCallback((): void => {
    if (phase.kind !== "in-game") return;
    send({ type: "game:resign", gameId: phase.gameId });
  }, [phase, send]);

  const submitMove = useCallback(
    (raw: string): void => {
      if (phase.kind !== "in-game") return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      send({ type: "move:propose", gameId: phase.gameId, raw: trimmed });
      setMoveInput("");
    },
    [phase, send],
  );

  const playAgain = useCallback((): void => {
    setPhase({ kind: "pre" });
  }, []);

  if (status === "connecting" && phase.kind === "pre") {
    return (
      <section className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-neutral-500">Connecting to game server…</p>
      </section>
    );
  }

  if (phase.kind === "pre") {
    return (
      <PreQueueView
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        selectedPreset={selectedPreset}
        onSelectPreset={setSelectedPreset}
        onFindGame={startQueue}
        onCreateInvite={createInvite}
        onStartBot={startBot}
        setupPanel={setupPanel}
        onSetupPanelChange={setSetupPanel}
        connected={status === "open"}
        invite={invite}
        joiningInvite={Boolean(inviteId) && invite.status === "joining"}
        botSide={botSide}
        onBotSideChange={setBotSide}
        botStrength={botStrength}
        onBotStrengthChange={setBotStrength}
      />
    );
  }

  if (phase.kind === "queueing") {
    return (
      <QueueingView
        mode={phase.mode}
        timeControl={phase.timeControl}
        queueDepth={phase.queueDepth}
        totalQueueDepth={phase.totalQueueDepth}
        onCancel={cancelQueue}
      />
    );
  }

  if (phase.kind === "ended") {
    return (
      <EndedView
        result={phase.result}
        termination={phase.termination}
        yourColor={phase.yourColor}
        ratingDeltaSelf={phase.ratingDeltaSelf}
        gameId={phase.gameId}
        onPlayAgain={playAgain}
      />
    );
  }

  return (
    <InGameView
      phase={phase}
      connected={status === "open"}
      moveInput={moveInput}
      onMoveInputChange={setMoveInput}
      onSubmitMove={submitMove}
      onResign={resign}
    />
  );
}

function reducePhase(current: Phase, msg: ServerGameMessage): Phase {
  switch (msg.type) {
    case "queue:waiting":
      if (current.kind !== "queueing") return current;
      return {
        ...current,
        queueDepth: msg.queueDepth,
        totalQueueDepth: msg.totalQueueDepth ?? msg.queueDepth,
      };

    case "game:start":
      return {
        kind: "in-game",
        gameId: msg.gameId,
        color: msg.color,
        opponent: msg.opponent,
        mode: msg.mode,
        fen: STARTING_FEN,
        turn: "white",
        moves: [],
        snapshot: {
          whiteMs: msg.timeControl.initialSeconds * 1000,
          blackMs: msg.timeControl.initialSeconds * 1000,
          turn: "white",
          asOf: Date.now(),
        },
        lastError: null,
        illegalCount: 0,
        opponentDisconnectedUntil: null,
      };

    case "game:state":
      if (current.kind !== "in-game" || current.gameId !== msg.gameId) return current;
      return {
        ...current,
        fen: msg.fen,
        turn: msg.turn,
        moves: msg.moves ?? (msg.lastMove ? [msg.lastMove] : current.moves),
        snapshot: {
          whiteMs: msg.whiteClockMs,
          blackMs: msg.blackClockMs,
          turn: msg.turn,
          asOf: Date.now(),
        },
        illegalCount: msg.illegalCount?.[current.color] ?? current.illegalCount,
        opponentDisconnectedUntil: null,
      };

    case "move:confirmed":
      if (current.kind !== "in-game" || current.gameId !== msg.gameId) return current;
      return {
        ...current,
        fen: msg.fen,
        turn: msg.turn,
        moves: [...current.moves, msg.move],
        snapshot: {
          whiteMs: msg.whiteClockMs,
          blackMs: msg.blackClockMs,
          turn: msg.turn,
          asOf: Date.now(),
        },
        lastError: null,
        opponentDisconnectedUntil: null,
      };

    case "move:rejected":
      if (current.kind !== "in-game" || current.gameId !== msg.gameId) return current;
      return {
        ...current,
        lastError: msg.reason,
        illegalCount: msg.illegalCount,
      };

    case "opponent:disconnected":
      if (current.kind !== "in-game" || current.gameId !== msg.gameId) return current;
      if (msg.color === current.color) return current;
      return {
        ...current,
        opponentDisconnectedUntil: msg.reconnectDeadlineMs,
      };

    case "game:end":
      if (current.kind !== "in-game" || current.gameId !== msg.gameId) return current;
      return {
        kind: "ended",
        gameId: msg.gameId,
        mode: current.mode,
        result: msg.result,
        termination: msg.termination,
        ratingDeltaSelf: msg.ratingDeltaSelf,
        yourColor: current.color,
      };

    default:
      return current;
  }
}

function PreQueueView(props: {
  selectedMode: Mode;
  onSelectMode: (m: Mode) => void;
  selectedPreset: TimeControlPreset;
  onSelectPreset: (p: TimeControlPreset) => void;
  onFindGame: () => void;
  onCreateInvite: () => void;
  onStartBot: () => void;
  setupPanel: SetupPanel;
  onSetupPanelChange: (panel: SetupPanel) => void;
  connected: boolean;
  invite: InviteState;
  joiningInvite: boolean;
  botSide: Color;
  onBotSideChange: (color: Color) => void;
  botStrength: number;
  onBotStrengthChange: (strength: number) => void;
}) {
  const [controlsOpen, setControlsOpen] = useState(true);
  return (
    <section className="flex flex-col gap-5">
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] xl:grid-cols-[minmax(0,760px)_22rem]">
        <div className="min-w-0">
          <div className="aspect-square w-full overflow-hidden rounded shadow-2xl shadow-black/40">
            <div className="grid h-full w-full grid-cols-8">
              {Array.from({ length: 64 }, (_, i) => {
                const row = Math.floor(i / 8);
                const col = i % 8;
                const dark = (row + col) % 2 === 1;
                return (
                  <div
                    key={i}
                    className={dark ? "bg-[#b58863]" : "bg-[#f0d9b5]"}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <aside className="min-w-0 rounded bg-[#262421] shadow-xl shadow-black/30 lg:sticky lg:top-4">
          <button
            type="button"
            onClick={() => setControlsOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            aria-expanded={controlsOpen}
          >
            <span>
              <span className="block text-xl font-bold tracking-tight">
                {props.setupPanel === "bot" ? "Play Stockfish" : "Play ChessTalk"}
              </span>
              <span className="block text-sm text-[#cfc8bd]">
                {props.setupPanel === "bot"
                  ? "Engine-powered bot game"
                  : "Guest play enabled"}
              </span>
            </span>
            <span className="rounded bg-[#3c3934] px-2 py-1 text-xs text-[#cfc8bd]">
              {controlsOpen ? "Collapse" : "Open"}
            </span>
          </button>

          <div className={controlsOpen ? "flex flex-col gap-5 px-5 pb-5" : "hidden lg:flex lg:flex-col lg:gap-3 lg:px-5 lg:pb-5"}>
            <p className="text-sm text-[#cfc8bd] lg:hidden">
              Play as a guest now, or sign in later for saved ratings.
            </p>

            {props.joiningInvite ? (
              <div className="rounded border border-[#9fca6b]/40 bg-[#3c4a2e] p-3 text-sm text-[#d4f0aa]">
                Joining invite…
              </div>
            ) : null}

            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9b948a]">
                Variant
              </legend>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2">
                {MODE_OPTIONS.map((opt) => {
                  const active = props.selectedMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => props.onSelectMode(opt.value)}
                      className={
                        "flex flex-col items-start rounded border p-3 text-left transition-colors " +
                        (active
                          ? "border-[#9fca6b] bg-[#3c4a2e] text-white"
                          : "border-[#4a4640] bg-[#312e2b] text-[#cfc8bd] hover:border-[#6b655d]")
                      }
                    >
                      <span className="text-base font-semibold">{opt.label}</span>
                      <span className="text-xs opacity-75">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9b948a]">
                Clock
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {TIME_CONTROL_OPTIONS.map((opt) => {
                  const active = props.selectedPreset === opt.preset;
                  return (
                    <button
                      key={opt.preset}
                      type="button"
                      onClick={() => props.onSelectPreset(opt.preset)}
                      className={
                        "rounded border px-4 py-3 text-center font-mono text-lg transition-colors " +
                        (active
                          ? "border-[#9fca6b] bg-[#3c4a2e] text-white"
                          : "border-[#4a4640] bg-[#312e2b] text-[#cfc8bd] hover:border-[#6b655d]")
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {props.setupPanel === "regular" ? (
              <>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={props.onFindGame}
                    disabled={!props.connected}
                    className="rounded bg-[#7fa650] px-5 py-4 text-lg font-semibold text-white shadow transition-colors hover:bg-[#8fbd5f] disabled:cursor-not-allowed disabled:bg-[#6b655d]"
                  >
                    {props.connected ? "Quick pairing" : "Connecting…"}
                  </button>
                  <button
                    type="button"
                    onClick={props.onCreateInvite}
                    disabled={!props.connected || props.invite.status === "creating"}
                    className="rounded bg-[#3c3934] px-5 py-3 text-base font-semibold text-[#f5f3ef] transition-colors hover:bg-[#4a4640] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {props.invite.status === "creating"
                      ? "Creating invite…"
                      : "Play with a friend"}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onSetupPanelChange("bot")}
                    disabled={!props.connected}
                    className="rounded bg-[#3c3934] px-5 py-3 text-base font-semibold text-[#f5f3ef] transition-colors hover:bg-[#4a4640] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Play bot
                  </button>
                </div>

                <InvitePanel invite={props.invite} />
              </>
            ) : (
              <BotSetupPanel
                botSide={props.botSide}
                onBotSideChange={props.onBotSideChange}
                botStrength={props.botStrength}
                onBotStrengthChange={props.onBotStrengthChange}
                onStartBot={props.onStartBot}
                onBack={() => props.onSetupPanelChange("regular")}
                connected={props.connected}
              />
            )}
          </div>
        </aside>
      </div>

      <PlayHistoryPanel />
    </section>
  );
}

function InvitePanel({ invite }: { invite: InviteState }) {
  const [copied, setCopied] = useState(false);
  if (invite.status === "idle" || invite.status === "creating" || invite.status === "joining") {
    return null;
  }

  const copy = async (): Promise<void> => {
    if (!invite.url) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded border border-[#4a4640] bg-[#312e2b] p-4 text-sm">
      {invite.error ? (
        <p className="mb-3 text-red-300">{invite.error}</p>
      ) : (
        <p className="mb-3 text-[#cfc8bd]">
          Send this link to a friend. The game starts when they join.
        </p>
      )}
      {invite.url ? (
        <div className="flex gap-2">
          <input
            readOnly
            value={invite.url}
            className="min-w-0 flex-1 rounded border border-[#4a4640] bg-[#262421] px-3 py-2 font-mono text-xs text-[#f5f3ef]"
          />
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded bg-[#7fa650] px-3 py-2 text-xs font-semibold text-white hover:bg-[#8fbd5f]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function BotSetupPanel(props: {
  botSide: Color;
  onBotSideChange: (color: Color) => void;
  botStrength: number;
  onBotStrengthChange: (strength: number) => void;
  onStartBot: () => void;
  onBack: () => void;
  connected: boolean;
}) {
  return (
    <div className="flex flex-col gap-5 rounded border border-[#4a4640] bg-[#312e2b] p-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Stockfish Bot</h2>
          <button
            type="button"
            onClick={props.onBack}
            className="rounded bg-[#262421] px-2 py-1 text-xs text-[#cfc8bd] hover:bg-[#3c3934]"
          >
            Back
          </button>
        </div>
        <p className="mt-1 text-sm text-[#cfc8bd]">
          Choose your side and engine strength, then test the full game loop.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9b948a]">
          Your color
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {([Color.White, Color.Black] as const).map((color) => {
            const active = props.botSide === color;
            return (
              <button
                key={color}
                type="button"
                onClick={() => props.onBotSideChange(color)}
                className={
                  "rounded border px-4 py-2 text-center text-sm font-semibold capitalize transition-colors " +
                  (active
                    ? "border-[#9fca6b] bg-[#3c4a2e] text-white"
                    : "border-[#4a4640] bg-[#262421] text-[#cfc8bd] hover:border-[#6b655d]")
                }
              >
                {color}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-[#9b948a]">
            Strength
          </legend>
          <span className="font-mono text-sm text-[#cfc8bd]">
            Lv {props.botStrength}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={20}
          value={props.botStrength}
          onChange={(e) => props.onBotStrengthChange(Number(e.target.value))}
          className="accent-[#7fa650]"
        />
        <div className="flex justify-between text-xs text-[#9b948a]">
          <span>Beginner</span>
          <span>Strong</span>
        </div>
      </fieldset>

      <button
        type="button"
        onClick={props.onStartBot}
        disabled={!props.connected}
        className="rounded bg-[#7fa650] px-5 py-4 text-lg font-semibold text-white shadow transition-colors hover:bg-[#8fbd5f] disabled:cursor-not-allowed disabled:bg-[#6b655d]"
      >
        Start vs Stockfish
      </button>
    </div>
  );
}

interface HistoryApiRow {
  id: string;
  mode: Mode;
  yourColor: Color;
  opponentUsername: string;
  result: GameResult | null;
  endedAt: string | null;
}

function resultText(result: GameResult | null, yourColor: Color): string {
  if (!result) return "In progress";
  if (result === "draw") return "Draw";
  return result === yourColor ? "Win" : "Loss";
}

function resultBadgeClass(result: GameResult | null, yourColor: Color): string {
  const outcome = resultText(result, yourColor);
  if (outcome === "Win") {
    return "border-[#9fca6b]/40 bg-[#3c4a2e] text-[#d4f0aa]";
  }
  if (outcome === "Loss") {
    return "border-[#b58863]/50 bg-[#3a2f28] text-[#f0d9b5]";
  }
  return "border-[#4a4640] bg-[#262421] text-[#cfc8bd]";
}

function PlayHistoryPanel() {
  const [rows, setRows] = useState<HistoryApiRow[]>([]);
  const [state, setState] = useState<"loading" | "guest" | "ready">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          setState("guest");
          return;
        }
        if (!res.ok) {
          setState("ready");
          return;
        }
        const data = (await res.json()) as { rows?: HistoryApiRow[] };
        setRows(data.rows ?? []);
        setState("ready");
      } catch {
        if (!cancelled) setState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded bg-[#262421] p-4 shadow-xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Game History</h2>
          <p className="text-xs text-[#9b948a]">
            Opponent and game ID from your saved games.
          </p>
        </div>
        <Link href="/history" className="text-sm text-[#9fca6b] hover:text-[#b7df7f]">
          View all
        </Link>
      </div>

      {state === "loading" ? (
        <p className="py-6 text-sm text-[#9b948a]">Loading history…</p>
      ) : state === "guest" ? (
        <div className="rounded bg-[#312e2b] p-4 text-sm text-[#cfc8bd]">
          Guest games are playable now. Sign in to save ratings and match history.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded bg-[#312e2b] p-4 text-sm text-[#9b948a]">
          No games yet. Start one above.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {rows.slice(0, 6).map((row) => (
            <Link
              key={row.id}
              href={`/game/${row.id}`}
              className="rounded bg-[#312e2b] p-3 text-sm hover:bg-[#3c3934]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{row.opponentUsername}</span>
                <span
                  className={`rounded border px-2 py-1 text-xs ${resultBadgeClass(row.result, row.yourColor)}`}
                >
                  {resultText(row.result, row.yourColor)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-[#9b948a]">
                <span>{row.mode === Mode.Easy ? "Easy" : "Blindfold"}</span>
                <span className="font-mono">{row.id.slice(0, 8)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function QueueingView(props: {
  mode: Mode;
  timeControl: TimeControl;
  queueDepth: number;
  totalQueueDepth: number;
  onCancel: () => void;
}) {
  const poolLabel = props.queueDepth === 1 ? "person" : "people";
  const totalLabel = props.totalQueueDepth === 1 ? "person" : "people";
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-300 border-t-emerald-600" />
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Looking for opponent…</h1>
        <p className="text-sm text-neutral-500">
          {props.mode === Mode.Easy ? "Easy" : "Blindfold"} ·{" "}
          {props.timeControl.initialSeconds / 60}+{props.timeControl.incrementSeconds}
        </p>
        <p className="text-sm text-neutral-400">
          {props.queueDepth} {poolLabel} searching this pool
        </p>
        <p className="text-xs text-neutral-500">
          {props.totalQueueDepth} {totalLabel} searching across all queues
        </p>
      </div>
      <button
        type="button"
        onClick={props.onCancel}
        className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Cancel
      </button>
    </section>
  );
}

interface InGamePhase {
  kind: "in-game";
  gameId: string;
  color: Color;
  opponent: OpponentInfo;
  mode: Mode;
  fen: string;
  turn: Color;
  moves: MoveRecord[];
  snapshot: ClockSnapshot;
  lastError: string | null;
  illegalCount: number;
  opponentDisconnectedUntil: number | null;
}

function InGameView(props: {
  phase: InGamePhase;
  connected: boolean;
  moveInput: string;
  onMoveInputChange: (v: string) => void;
  onSubmitMove: (raw: string) => void;
  onResign: () => void;
}) {
  const { phase } = props;
  const display = useClock(phase.snapshot);
  const isReconnecting = !props.connected;
  const isYourTurn = phase.turn === phase.color;
  const lastMove = phase.moves.length > 0 ? phase.moves[phase.moves.length - 1] ?? null : null;
  const orientation: "white" | "black" = phase.color;
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const mic = useMicStream({ enabled: props.connected && isYourTurn });
  const audio = useAudioSocket({
    gameId: phase.gameId,
    onMessage: (msg) => {
      if (msg.type === "stt:interim" || msg.type === "stt:final") {
        setVoiceTranscript(msg.text);
      } else if (msg.type === "stt:ambiguous") {
        const options = msg.candidates.length > 0 ? `: ${msg.candidates.join(" or ")}` : "";
        setVoiceTranscript(`${msg.message}${options}`);
      } else if (msg.type === "stt:error") {
        setVoiceTranscript(msg.message);
      }
    },
  });
  const { send: sendAudio, sendBinary: sendAudioBinary, status: audioStatus } = audio;

  useEffect(() => {
    if (props.connected && isYourTurn) {
      sendAudio({ type: "audio:start", gameId: phase.gameId });
    } else {
      sendAudio({ type: "audio:stop", gameId: phase.gameId });
      setVoiceTranscript("");
    }
  }, [sendAudio, isYourTurn, phase.gameId, props.connected]);

  useVoiceRecorder({
    stream: mic.stream,
    active: props.connected && isYourTurn && mic.status === "ready" && audioStatus === "open",
    onChunk: sendAudioBinary,
  });

  const opponentColor: Color = phase.color === "white" ? "black" : "white";
  const topColor = opponentColor;
  const bottomColor = phase.color;
  const topMs = topColor === "white" ? display.whiteMs : display.blackMs;
  const bottomMs = bottomColor === "white" ? display.whiteMs : display.blackMs;

  const isBlindfold = phase.mode === Mode.Blindfold;

  return (
    <section className="flex flex-col gap-4 rounded bg-[#262421] p-4 shadow-2xl shadow-black/30">
      <header className="flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold">
            vs {phase.opponent.username}{" "}
            <span className="font-mono text-sm text-neutral-500">
              ({phase.opponent.rating})
            </span>
          </h1>
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            {isBlindfold ? "Blindfold" : "Easy"} · You are {phase.color}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onResign}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Resign
        </button>
      </header>

      <ConnectionBanner
        connected={props.connected}
        opponentDisconnectedUntil={phase.opponentDisconnectedUntil}
      />

      <YourTurnBanner isYourTurn={isYourTurn} color={phase.color} disabled={isReconnecting} />

      <div className="grid gap-5 lg:grid-cols-[minmax(420px,720px)_22rem]">
        <div className="flex flex-col gap-3">
          <Clock ms={topMs} isActive={phase.turn === topColor} color={topColor} />
          {isBlindfold ? (
            <BlindfoldPanel lastMove={lastMove} isYourTurn={isYourTurn} />
          ) : (
            <div className="aspect-square w-full overflow-hidden rounded shadow-xl shadow-black/30">
              <GameBoard
                fen={phase.fen}
                boardOrientation={orientation}
                lastMove={lastMove}
              />
            </div>
          )}
          <Clock ms={bottomMs} isActive={phase.turn === bottomColor} color={bottomColor} />

          <VoiceCapsule
            isYourTurn={isYourTurn}
            analyser={mic.analyser}
            micStatus={mic.status}
            audioStatus={audioStatus}
            transcript={voiceTranscript}
            error={isReconnecting ? "Reconnecting to game server..." : phase.lastError}
            illegalCount={phase.illegalCount}
            onEnableMic={() => {
              void mic.request();
            }}
            onSubmitTranscript={(text) => {
              setVoiceTranscript(text);
              if (!props.connected) return;
              sendAudio({ type: "audio:transcript", gameId: phase.gameId, text });
            }}
          />

          <MoveInput
            value={props.moveInput}
            onChange={props.onMoveInputChange}
            onSubmit={props.onSubmitMove}
            disabled={!props.connected || !isYourTurn}
            error={phase.lastError}
            illegalCount={phase.illegalCount}
          />
        </div>

        <aside className="flex flex-col gap-3 rounded bg-[#312e2b] p-4">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[#9b948a]">
            Moves
          </h2>
          <div className="max-h-[60vh] overflow-y-auto">
            <MoveList moves={phase.moves} />
          </div>
        </aside>
      </div>
    </section>
  );
}

function ConnectionBanner({
  connected,
  opponentDisconnectedUntil,
}: {
  connected: boolean;
  opponentDisconnectedUntil: number | null;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (connected && opponentDisconnectedUntil === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [connected, opponentDisconnectedUntil]);

  if (!connected) {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
        Reconnecting&hellip; you have about 10 seconds before the game is forfeited.
      </div>
    );
  }

  if (opponentDisconnectedUntil === null) return null;
  const remainingSeconds = Math.max(0, Math.ceil((opponentDisconnectedUntil - now) / 1000));
  return (
    <div className="rounded border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
      Opponent disconnected. You win if they do not reconnect in {remainingSeconds}s.
    </div>
  );
}

function YourTurnBanner({
  isYourTurn,
  color,
  disabled,
}: {
  isYourTurn: boolean;
  color: Color;
  disabled: boolean;
}) {
  const active = isYourTurn && !disabled;
  return (
    <div
      className={
        "rounded px-5 py-4 text-center transition-all " +
        (active
          ? "bg-[#7fa650] text-white shadow-md"
          : "bg-[#312e2b] text-[#cfc8bd]")
      }
    >
      <p className="text-xs font-semibold uppercase tracking-[0.28em] opacity-80">
        {disabled ? "Reconnecting" : isYourTurn ? "Your turn" : "Opponent's turn"}
      </p>
      <p className="mt-1 text-xl font-bold">
        {disabled
          ? "Moves are paused until the socket is back"
          : isYourTurn
          ? `Speak a move for ${color}`
          : "Your mic is muted while you wait"}
      </p>
    </div>
  );
}

function BlindfoldPanel({
  lastMove,
  isYourTurn,
}: {
  lastMove: MoveRecord | null;
  isYourTurn: boolean;
}) {
  return (
    <div
      className={
        "flex aspect-square w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-all " +
        (isYourTurn
          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-neutral-300 dark:border-neutral-700")
      }
    >
      <p className="text-xs uppercase tracking-wider text-neutral-500">
        Blindfold
      </p>
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-neutral-500">Opponent&apos;s last move</span>
        <span className="font-mono text-5xl font-bold tracking-wide">
          {lastMove?.san ?? "—"}
        </span>
      </div>
      <p className="text-sm font-medium">
        {isYourTurn ? "Your move" : "Waiting on opponent…"}
      </p>
    </div>
  );
}

function MoveInput(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (raw: string) => void;
  disabled: boolean;
  error: string | null;
  illegalCount: number;
}) {
  const helperText = useMemo(() => {
    if (props.error) {
      return `${props.error}${
        props.illegalCount > 0 ? ` (${props.illegalCount}/3)` : ""
      }`;
    }
    return props.disabled
      ? "Waiting for opponent…"
      : "Type a move in SAN (e.g. e4, Nf3, O-O) and press Enter";
  }, [props.error, props.illegalCount, props.disabled]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(props.value);
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          disabled={props.disabled}
          placeholder="e.g. e4"
          autoFocus
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-base shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-950"
        />
        <button
          type="submit"
          disabled={props.disabled || props.value.trim().length === 0}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-400"
        >
          Make move
        </button>
      </div>
      <p
        className={
          "text-xs " +
          (props.error
            ? "text-red-600 dark:text-red-400"
            : "text-neutral-500")
        }
      >
        {helperText}
      </p>
    </form>
  );
}

function EndedView(props: {
  result: GameResult;
  termination: Termination;
  yourColor: Color;
  ratingDeltaSelf: number;
  gameId: string;
  onPlayAgain: () => void;
}) {
  const outcome = formatResult(props.result, props.yourColor);
  const deltaSign = props.ratingDeltaSelf > 0 ? "+" : "";
  const cardClass =
    outcome === "Win"
      ? "border-[#9fca6b]/50 bg-[#3c4a2e] text-[#f5f3ef]"
      : outcome === "Loss"
        ? "border-[#b58863]/60 bg-[#3a2f28] text-[#f5f3ef]"
        : "border-[#4a4640] bg-[#262421] text-[#f5f3ef]";
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
      <div className={`w-full rounded-xl border p-8 shadow-xl shadow-black/30 ${cardClass}`}>
        <p className="text-xs uppercase tracking-wider text-[#cfc8bd]">
          {describeTermination(props.termination)}
        </p>
        <h1 className="mt-2 text-4xl font-bold">{outcome}</h1>
        <p className="mt-2 font-mono text-sm text-[#cfc8bd]">
          Rating {deltaSign}
          {props.ratingDeltaSelf}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={props.onPlayAgain}
          className="rounded-md bg-[#7fa650] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#8fbd5f]"
        >
          Play again
        </button>
        <Link
          href={`/game/${props.gameId}`}
          className="rounded-md border border-[#4a4640] px-5 py-2.5 text-sm text-[#cfc8bd] hover:bg-[#2f2d29] hover:text-white"
        >
          Replay this game
        </Link>
      </div>
    </section>
  );
}
