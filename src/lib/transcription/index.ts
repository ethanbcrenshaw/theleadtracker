// Transcription provider layer.
//
// A small swappable interface so the live-call transcription engine can change
// (browser Web Speech today, a paid streaming service like Deepgram later)
// without touching the Call Assistant UI. `getTranscriptionProvider()` returns
// the first supported provider — Web Speech in Chrome/Edge, nothing elsewhere.

export interface TranscriptSegment {
  /** Finalized (or interim) recognized text. */
  text: string;
  /** Wall-clock timestamp (Date.now()) when the segment was produced. */
  at: number;
  /** True once the engine considers this text final and won't revise it. */
  final: boolean;
}

export interface TranscriptionSession {
  stop(): void;
  pause(): void;
  resume(): void;
}

export interface TranscriptionHandlers {
  /** A finalized segment — safe to append to the transcript permanently. */
  onSegment(s: TranscriptSegment): void;
  /** In-flight text that is replaced on every call until it finalizes. */
  onInterim(text: string): void;
  onError(e: { code: string; message: string; fatal: boolean }): void;
  onStateChange(state: "listening" | "paused" | "stopped"): void;
}

export interface TranscriptionProvider {
  readonly id: "webspeech" | "deepgram";
  isSupported(): boolean;
  start(handlers: TranscriptionHandlers): Promise<TranscriptionSession>;
}

import { webSpeechProvider } from "./webspeech";
import { deepgramProvider } from "./deepgram";

/** Ordered by preference; first supported wins. */
const PROVIDERS: TranscriptionProvider[] = [deepgramProvider, webSpeechProvider];

/**
 * Returns the first supported transcription provider, or null when the browser
 * supports none (the UI shows a "use Chrome or Edge" notice in that case).
 */
export function getTranscriptionProvider(): TranscriptionProvider | null {
  for (const p of PROVIDERS) {
    if (p.isSupported()) return p;
  }
  return null;
}
