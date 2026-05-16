"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MicStreamStatus = "idle" | "requesting" | "ready" | "denied" | "error";

export interface UseMicStreamOptions {
  // Whether the mic should be capturing for transmission. Flips track.enabled
  // (server-authoritative — caller passes their turn state in).
  enabled: boolean;
}

export interface UseMicStreamResult {
  status: MicStreamStatus;
  stream: MediaStream | null;
  analyser: AnalyserNode | null;
  error: string | null;
  // Must be called from a user gesture the first time (browser autoplay
  // policies require it). Subsequent calls are no-ops once the stream exists.
  request: () => Promise<MediaStream | null>;
}

export function useMicStream(opts: UseMicStreamOptions): UseMicStreamResult {
  const { enabled } = opts;
  const [status, setStatus] = useState<MicStreamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const request = useCallback(async (): Promise<MediaStream | null> => {
    if (streamRef.current) return streamRef.current;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setStatus("error");
      setError("Microphone APIs not available");
      return null;
    }
    setStatus("requesting");
    setError(null);
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = ms;
      setStream(ms);

      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) {
        setStatus("error");
        setError("AudioContext not supported");
        return ms;
      }
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(ms);
      sourceRef.current = source;
      const node = ctx.createAnalyser();
      node.fftSize = 256;
      node.smoothingTimeConstant = 0.75;
      source.connect(node);
      analyserRef.current = node;
      setAnalyser(node);

      setStatus("ready");
      return ms;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone error";
      const denied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError");
      setStatus(denied ? "denied" : "error");
      setError(message);
      return null;
    }
  }, []);

  // Mirror the `enabled` prop onto every audio track.
  // WHY: track.enabled gates *transmitted* audio but the browser's mic
  // indicator stays lit because the underlying capture is still active.
  // That's acceptable in M3; fully releasing the device would force a new
  // permission prompt on the next turn.
  useEffect(() => {
    const ms = streamRef.current;
    if (!ms) return;
    for (const track of ms.getAudioTracks()) {
      track.enabled = enabled;
    }
  }, [enabled, stream]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      try {
        sourceRef.current?.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
      analyserRef.current = null;
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "closed") {
        void ctx.close().catch(() => {
          // ignore
        });
      }
      audioCtxRef.current = null;
    };
  }, []);

  return { status, stream, analyser, error, request };
}
