// Web Speech API transcription — the zero-key, zero-cost provider.
//
// Works in Chrome and Edge via webkitSpeechRecognition. The mic captures BOTH
// voices on a speakerphone call, mixed with no speaker labels — that's expected;
// we do not attempt diarization (a paid streaming service would; see deepgram.ts).
//
// Chrome quirk: recognition silently ends after a pause or ~60s of audio. We
// auto-restart in `onend` while the session is active, preserving all finalized
// segments across restarts, so a silent stretch mid-call resumes cleanly.

import type { TranscriptionHandlers, TranscriptionProvider, TranscriptionSession } from "./index";

// ── Minimal Web Speech typings (not in lib.dom across all TS configs) ────────
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const webSpeechProvider: TranscriptionProvider = {
  id: "webspeech",

  isSupported() {
    return getCtor() !== null;
  },

  async start(handlers: TranscriptionHandlers): Promise<TranscriptionSession> {
    const Ctor = getCtor();
    if (!Ctor) {
      throw new Error("Web Speech API unavailable — use Chrome or Edge.");
    }

    // Proactively request the mic so a denial surfaces as one clean error
    // rather than a cryptic recognition `not-allowed` a beat later.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // We don't feed the stream to recognition (it opens its own), so release it.
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      throw new Error("Microphone permission denied. Allow mic access and try again.");
    }

    let active = true; // false once stop() is called — gates auto-restart
    let paused = false;
    let networkRetriedAt = 0; // debounce the single network/audio-capture retry
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const safeStart = () => {
      try {
        rec.start();
      } catch {
        // start() throws if already started — harmless, ignore.
      }
    };

    rec.onstart = () => {
      handlers.onStateChange(paused ? "paused" : "listening");
    };

    rec.onresult = (e) => {
      if (paused) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const trimmed = text.trim();
          if (trimmed) handlers.onSegment({ text: trimmed, at: Date.now(), final: true });
        } else {
          interim += text;
        }
      }
      handlers.onInterim(interim.trim());
    };

    rec.onerror = (e) => {
      const code = e.error || "unknown";
      if (code === "no-speech") {
        // Expected during quiet stretches — keep listening, don't surface.
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        active = false;
        handlers.onError({
          code,
          message: "Microphone permission was blocked. Allow mic access to transcribe.",
          fatal: true,
        });
        return;
      }
      if (code === "aborted") {
        // We called abort()/stop() ourselves — not an error to surface.
        return;
      }
      if (code === "network" || code === "audio-capture") {
        const now = Date.now();
        if (now - networkRetriedAt > 5000) {
          // Attempt one restart before giving up on this class of error.
          networkRetriedAt = now;
          handlers.onError({
            code,
            message:
              code === "network"
                ? "Speech network hiccup — retrying."
                : "Audio capture glitch — retrying.",
            fatal: false,
          });
          // onend will fire next and auto-restart while active.
          return;
        }
        active = false;
        handlers.onError({
          code,
          message:
            code === "network"
              ? "Speech recognition lost its network connection."
              : "Lost access to the microphone.",
          fatal: true,
        });
        return;
      }
      // Unknown, non-fatal — log it but keep the session going.
      handlers.onError({ code, message: e.message || `Recognition error: ${code}`, fatal: false });
    };

    rec.onend = () => {
      // Chrome ends recognition on its own after pauses/timeouts. Restart while
      // the session is active and not paused; finalized segments already emitted
      // are retained by the caller, so nothing is lost.
      if (active && !paused) {
        safeStart();
      } else if (!active) {
        handlers.onStateChange("stopped");
      }
    };

    safeStart();

    return {
      stop() {
        active = false;
        paused = false;
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      },
      pause() {
        if (!active) return;
        paused = true;
        handlers.onStateChange("paused");
        try {
          rec.stop(); // onend won't restart while paused
        } catch {
          /* ignore */
        }
      },
      resume() {
        if (!active) return;
        paused = false;
        handlers.onStateChange("listening");
        safeStart();
      },
    };
  },
};
