"use client";

import { useEffect, useRef, useState } from "react";

type VoiceState = "idle" | "listening" | "processing" | "confirmed" | "rejected" | "waiting";

interface VoiceCapsuleProps {
  isYourTurn: boolean;
  analyser: AnalyserNode | null;
  micStatus: string;
  audioStatus: string;
  transcript: string;
  error: string | null;
  illegalCount: number;
  onEnableMic: () => void;
  onSubmitTranscript: (text: string) => void;
}

function voiceState(props: VoiceCapsuleProps): VoiceState {
  if (!props.isYourTurn) return "waiting";
  if (props.error) return "rejected";
  if (props.transcript.trim().length > 0) return "processing";
  if (props.micStatus === "ready" && props.audioStatus === "open") return "listening";
  return "idle";
}

function promptFor(state: VoiceState, props: VoiceCapsuleProps): string {
  switch (state) {
    case "waiting":
      return "Waiting on opponent";
    case "rejected":
      return `${props.error ?? "Couldn't parse that"}${
        props.illegalCount > 0 ? ` - ${props.illegalCount}/3` : ""
      }`;
    case "processing":
      return "Processing what you said";
    case "listening":
      return "Your move - say it out loud";
    case "confirmed":
      return "Move confirmed";
    case "idle":
      return "Enable mic when it's your turn";
  }
}

export function VoiceCapsule(props: VoiceCapsuleProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = voiceState(props);
  const [testTranscript, setTestTranscript] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = props.analyser;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    let raf = 0;

    const render = () => {
      frame += 1;
      analyser.getByteFrequencyData(data);
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = props.isYourTurn ? "#7fa650" : "#6b655d";

      const bars = 32;
      const barWidth = width / bars;
      for (let i = 0; i < bars; i += 1) {
        const bucket = data[Math.floor((i / bars) * data.length)] ?? 0;
        const idlePulse = props.isYourTurn ? 8 + Math.sin(frame / 8 + i) * 4 : 4;
        const barHeight = Math.max(idlePulse, (bucket / 255) * height);
        const x = i * barWidth + 1;
        const y = (height - barHeight) / 2;
        ctx.globalAlpha = props.isYourTurn ? 0.9 : 0.35;
        ctx.fillRect(x, y, Math.max(2, barWidth - 3), barHeight);
      }
      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [props.analyser, props.isYourTurn]);

  const shellClass = [
    "rounded border p-4 shadow-sm transition-all",
    state === "waiting"
      ? "border-[#4a4640] bg-[#262421] opacity-80 text-[#cfc8bd]"
      : "",
    state === "idle"
      ? "border-[#4a4640] bg-[#312e2b] text-[#f5f3ef]"
      : "",
    state === "listening" || state === "processing"
      ? "border-[#7fa650] bg-[#3c4a2e] text-[#f5f3ef] shadow-[#7fa650]/20"
      : "",
    state === "rejected"
      ? "border-[#9a4f4f] bg-[#3a2725] text-[#f5f3ef]"
      : "",
  ].join(" ");

  return (
    <div className={shellClass} aria-live="polite">
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9b948a]">
              Voice input
            </p>
            <p className="mt-1 text-lg font-semibold">{promptFor(state, props)}</p>
          </div>
          <span className="rounded-full bg-[#262421] px-2.5 py-1 text-xs font-medium text-[#cfc8bd] shadow-sm">
            {props.audioStatus}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          width={640}
          height={64}
          className="h-16 w-full rounded bg-[#262421]"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="min-h-6 flex-1 rounded bg-[#262421] px-3 py-2 font-mono text-sm text-[#cfc8bd]">
            {props.transcript || (props.isYourTurn ? "listening..." : "opponent thinking...")}
          </p>
          <button
            type="button"
            onClick={props.onEnableMic}
            disabled={!props.isYourTurn || props.micStatus === "ready"}
            className="shrink-0 rounded bg-[#7fa650] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#8fbd5f] disabled:cursor-not-allowed disabled:bg-[#6b655d]"
          >
            {props.micStatus === "ready" ? "Mic ready" : "Enable mic"}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = testTranscript.trim();
            if (!trimmed) return;
            props.onSubmitTranscript(trimmed);
            setTestTranscript("");
          }}
          className="flex flex-col gap-1"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={testTranscript}
              onChange={(e) => setTestTranscript(e.target.value)}
              disabled={!props.isYourTurn}
              placeholder="Test spoken move, e.g. knight to f3"
              className="min-w-0 flex-1 rounded border border-[#4a4640] bg-[#262421] px-3 py-2 text-sm text-[#f5f3ef] shadow-sm focus:border-[#7fa650] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#1f1e1b]"
            />
            <button
              type="submit"
              disabled={!props.isYourTurn || testTranscript.trim().length === 0}
              className="shrink-0 rounded border border-[#7fa650] px-3 py-2 text-sm font-semibold text-[#d4f0aa] transition-colors hover:bg-[#3c4a2e] disabled:cursor-not-allowed disabled:border-[#4a4640] disabled:text-[#6b655d]"
            >
              Send transcript
            </button>
          </div>
          <p className="text-xs text-[#9b948a]">
            Dev path: sends text through /audio, then parser + dispatcher.
          </p>
        </form>
      </div>
    </div>
  );
}
