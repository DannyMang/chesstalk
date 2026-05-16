"use client";

import { useEffect, useRef } from "react";

// Narrow shape for the bits of MediaRecorder we use. lib.dom.d.ts ships
// MediaRecorder types, but we keep an explicit interface so the optional
// `isTypeSupported` static + constructor option subset are easy to mock if
// needed and to avoid `any` in a few places where Bun's TS view of lib differs.
type RecorderState = "inactive" | "recording" | "paused";

interface MediaRecorderLike {
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((this: MediaRecorderLike, ev: BlobEvent) => void) | null;
  onerror: ((this: MediaRecorderLike, ev: Event) => void) | null;
  onstop: ((this: MediaRecorderLike, ev: Event) => void) | null;
  readonly state: RecorderState;
}

type MediaRecorderCtor = new (
  stream: MediaStream,
  options?: MediaRecorderOptions,
) => MediaRecorderLike;

function getRecorderCtor(): MediaRecorderCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    MediaRecorder?: MediaRecorderCtor & {
      isTypeSupported?: (type: string) => boolean;
    };
  };
  return w.MediaRecorder ?? null;
}

function pickMimeType(Ctor: MediaRecorderCtor): string | undefined {
  const supports = (Ctor as unknown as { isTypeSupported?: (t: string) => boolean })
    .isTypeSupported;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  if (!supports) return undefined;
  for (const mime of candidates) {
    try {
      if (supports(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export interface UseVoiceRecorderOptions {
  stream: MediaStream | null;
  active: boolean; // enabled && isMyTurn — recorder runs only when true
  timesliceMs?: number;
  onChunk: (chunk: Blob) => void;
  onError?: (message: string) => void;
}

export function useVoiceRecorder(opts: UseVoiceRecorderOptions): void {
  const recorderRef = useRef<MediaRecorderLike | null>(null);
  // Latest callbacks via ref so the start/stop effect doesn't churn.
  const onChunkRef = useRef(opts.onChunk);
  const onErrorRef = useRef(opts.onError);
  onChunkRef.current = opts.onChunk;
  onErrorRef.current = opts.onError;

  const timeslice = opts.timesliceMs ?? 20;
  const stream = opts.stream;
  const active = opts.active;

  useEffect(() => {
    if (!stream) return;
    if (!active) return;
    const Ctor = getRecorderCtor();
    if (!Ctor) {
      onErrorRef.current?.("MediaRecorder is not supported in this browser");
      return;
    }
    const mimeType = pickMimeType(Ctor);
    let recorder: MediaRecorderLike;
    try {
      recorder = mimeType ? new Ctor(stream, { mimeType }) : new Ctor(stream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recorder init failed";
      onErrorRef.current?.(msg);
      return;
    }
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) onChunkRef.current(ev.data);
    };
    recorder.onerror = (ev: Event) => {
      // ErrorEvent shape varies between browsers; coerce safely.
      const message =
        (ev as ErrorEvent).message ?? "MediaRecorder error";
      onErrorRef.current?.(message);
    };
    try {
      recorder.start(timeslice);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Recorder start failed";
      onErrorRef.current?.(msg);
      return;
    }
    recorderRef.current = recorder;

    return () => {
      const r = recorderRef.current;
      recorderRef.current = null;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          // ignore
        }
      }
    };
  }, [stream, active, timeslice]);
}
