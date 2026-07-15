// Deepgram streaming provider — STUB (not implemented).
//
// This is the upgrade path from browser Web Speech to a paid streaming service
// with real speaker diarization (so "you" vs "the prospect" turns are labeled
// instead of one mixed blob). It reports isSupported(): false today so the
// factory falls through to Web Speech; no key handling exists yet.
//
// TODO — future implementation:
//   1. Server route `/api/transcription-token` mints a SHORT-LIVED Deepgram
//      token (Deepgram's `/v1/auth/grant`, ~30s TTL) so the long-lived API key
//      never reaches the browser. Reads DEEPGRAM_API_KEY from env, same pattern
//      as the AI provider layer in ai.server.ts.
//   2. `start()` opens a WebSocket to
//      wss://api.deepgram.com/v1/listen?model=nova-3&diarize=true&interim_results=true&smart_format=true
//      authenticated with that token, and pipes mic audio from
//      getUserMedia() → MediaRecorder / AudioWorklet as 16kHz PCM/opus frames.
//   3. Map Deepgram `Results` messages to segments: `is_final` → onSegment,
//      otherwise onInterim. With diarization on, prefix each segment with its
//      speaker label so the summarize prompt gets real turns instead of a
//      speaker-less transcript.
//   4. Handle socket close/keepalive (Deepgram closes on ~10s silence — send
//      KeepAlive frames), and surface auth/quota errors as fatal.
//   5. isSupported() returns true only when a token endpoint is reachable.

import type { TranscriptionProvider, TranscriptionSession } from "./index";

export const deepgramProvider: TranscriptionProvider = {
  id: "deepgram",

  isSupported() {
    return false;
  },

  async start(): Promise<TranscriptionSession> {
    throw new Error("Deepgram provider is not implemented yet.");
  },
};
