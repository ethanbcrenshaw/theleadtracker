import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Mic, Square, Pause, Play, Loader2, Sparkles, AlertCircle, Check,
  Calendar, Video, FileText, Save, Trash2, Pencil, Radio,
} from "lucide-react";
import type { CallRecord, Lead, LeadStatus } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { STATUSES } from "@/lib/crm-utils";

interface Props {
  lead: Lead | null;
  onClose: () => void;
}

type Stage = "record" | "processing" | "review";

type Updates = {
  summary: string;
  outcome: string;
  answered: boolean;
  interested: boolean;
  suggestedStatus: LeadStatus;
  followUpDate: string | null;
  zoomBooked: boolean;
  zoomDate: string | null;
  objections: string[];
  websitePainPoints: string[];
  onlinePresenceNotes: string;
  nextAction: string;
  opportunitySummary: string;
};

type SignalKind = "idle" | "listening" | "speech" | "quiet" | "tone" | "no-speech";

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative };
type RecognitionResultListLike = { length: number; [index: number]: RecognitionResult };
type SpeechRecognitionEventLike = Event & { resultIndex: number; results: RecognitionResultListLike };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const r = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${r}`;
}

export function CallAssistant({ lead, onClose }: Props) {
  const updateLead = useLeads((s) => s.updateLead);
  const addCallRecord = useLeads((s) => s.addCallRecord);
  const setStatus = useLeads((s) => s.setStatus);
  const addNote = useLeads((s) => s.addNote);

  const [stage, setStage] = useState<Stage>("record");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Updates | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [signal, setSignal] = useState<SignalKind>("idle");
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const shouldRestartRecognitionRef = useRef(false);
  const pausedRef = useRef(false);
  const recordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const speechFramesRef = useRef(0);
  const toneFramesRef = useRef(0);
  const quietFramesRef = useRef(0);

  // Reset on lead change / close
  useEffect(() => {
    if (!lead) return;
    setStage("record");
    setTranscript("");
    setUpdates(null);
    setError(null);
    setElapsed(0);
    setRecording(false);
    setPaused(false);
    recordingRef.current = false;
    pausedRef.current = false;
    setPermissionDenied(false);
    setInterimTranscript("");
    setSignal("idle");
    setAudioLevel(0);
    finalTranscriptRef.current = "";
    accumulatedMsRef.current = 0;
    startedAtRef.current = null;
    speechFramesRef.current = 0;
    toneFramesRef.current = 0;
    quietFramesRef.current = 0;
    stopSpeechRecognition();
    stopAudioMonitor();
  }, [lead?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      stopSpeechRecognition();
      stopAudioMonitor();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer() {
    stopTimer();
    startedAtRef.current = Date.now();
    timerRef.current = window.setInterval(() => {
      if (startedAtRef.current === null) return;
      setElapsed(Math.floor((accumulatedMsRef.current + Date.now() - startedAtRef.current) / 1000));
    }, 250);
  }

  function pauseTimer() {
    if (startedAtRef.current !== null) {
      accumulatedMsRef.current += Date.now() - startedAtRef.current;
      startedAtRef.current = null;
      setElapsed(Math.floor(accumulatedMsRef.current / 1000));
    }
    stopTimer();
  }

  function resetTimer() {
    stopTimer();
    startedAtRef.current = null;
    accumulatedMsRef.current = 0;
    setElapsed(0);
  }

  function startSpeechRecognition() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setSpeechSupported(false);
      return;
    }
    setSpeechSupported(true);
    shouldRestartRecognitionRef.current = true;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) finalText += piece;
        else interimText += piece;
      }
      if (finalText.trim()) {
        finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalText.trim()}`.trim();
        setTranscript(finalTranscriptRef.current);
        speechFramesRef.current += 10;
        setSignal("speech");
      }
      setInterimTranscript(interimText.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        shouldRestartRecognitionRef.current = false;
        setPermissionDenied(true);
        setError("Microphone speech recognition was blocked. You can still paste the transcript manually.");
      }
    };
    recognition.onend = () => {
      if (shouldRestartRecognitionRef.current && recordingRef.current && !pausedRef.current) {
        window.setTimeout(() => {
          try { recognition.start(); } catch { /* already started */ }
        }, 250);
      }
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setSignal("listening");
    } catch {
      setSpeechSupported(false);
    }
  }

  function stopSpeechRecognition() {
    shouldRestartRecognitionRef.current = false;
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = null;
    try { recognition.stop(); } catch { /* noop */ }
    recognitionRef.current = null;
    setInterimTranscript("");
  }

  function startAudioMonitor(stream: MediaStream) {
    stopAudioMonitor();
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    ctx.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
      const peak = Math.max(...data);
      const peakIndex = data.findIndex((v) => v === peak);
      const peakHz = peakIndex * ctx.sampleRate / analyser.fftSize;
      const level = Math.min(100, Math.round((avg / 80) * 100));
      setAudioLevel(level);

      if (avg < 4) {
        quietFramesRef.current += 1;
        if (quietFramesRef.current > 90 && !finalTranscriptRef.current) setSignal("no-speech");
      } else {
        quietFramesRef.current = 0;
        const isToneLike = peak > 95 && avg > 10 && peakHz >= 300 && peakHz <= 700;
        if (isToneLike && !finalTranscriptRef.current) {
          toneFramesRef.current += 1;
          if (toneFramesRef.current > 40) setSignal("tone");
        } else if (!finalTranscriptRef.current) {
          setSignal("quiet");
        }
      }
      audioFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }

  function stopAudioMonitor() {
    if (audioFrameRef.current) window.cancelAnimationFrame(audioFrameRef.current);
    audioFrameRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setAudioLevel(0);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      mr.start();
      finalTranscriptRef.current = transcript.trim();
      recordingRef.current = true;
      pausedRef.current = false;
      speechFramesRef.current = 0;
      toneFramesRef.current = 0;
      quietFramesRef.current = 0;
      setRecording(true);
      setPaused(false);
      startTimer();
      startAudioMonitor(stream);
      startSpeechRecognition();
    } catch {
      setPermissionDenied(true);
      setError("Microphone permission denied. You can paste a transcript manually below.");
    }
  }

  function pauseRecording() {
    if (!mediaRef.current) return;
    if (paused) {
      mediaRef.current.resume();
      pausedRef.current = false;
      setPaused(false);
      startTimer();
      startSpeechRecognition();
    } else {
      mediaRef.current.pause();
      pausedRef.current = true;
      setPaused(true);
      pauseTimer();
      stopSpeechRecognition();
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    streamRef.current = null;
    recordingRef.current = false;
    pausedRef.current = false;
    pauseTimer();
    stopSpeechRecognition();
    stopAudioMonitor();
    setRecording(false);
    setPaused(false);
    if (!finalTranscriptRef.current.trim()) {
      if (signal === "tone") {
        setError("Dial tone/no answer detected. Review the suggested follow-up before saving.");
      } else if (elapsed >= 8) {
        setError("No speech was detected. Review the suggested no-answer follow-up before saving.");
      }
    }
  }

  async function processTranscript() {
    if (!lead) return;
    if (!transcript.trim() || transcript.trim().length < 10) {
      setError("Please enter or record a transcript (at least a sentence) before summarizing.");
      return;
    }
    setStage("processing");
    setError(null);
    try {
      const res = await fetch("/api/summarize-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          lead: {
            business: lead.business,
            city: lead.city,
            state: lead.state,
            websiteOpportunity: lead.websiteOpportunity,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to summarize");
      setUpdates({
        ...data.updates,
        suggestedStatus: (STATUSES as readonly string[]).includes(data.updates.suggestedStatus)
          ? data.updates.suggestedStatus
          : lead.status,
      });
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("record");
    }
  }

  function buildRecord(): CallRecord {
    const u = updates!;
    return {
      id: crypto.randomUUID(),
      leadId: lead!.id,
      createdAt: new Date().toISOString(),
      transcript,
      summary: u.summary,
      outcome: u.outcome,
      answered: u.answered,
      interested: u.interested,
      suggestedStatus: u.suggestedStatus,
      followUpDate: u.followUpDate,
      zoomBooked: u.zoomBooked,
      zoomDate: u.zoomDate,
      objections: u.objections,
      websitePainPoints: u.websitePainPoints,
      onlinePresenceNotes: u.onlinePresenceNotes,
      nextAction: u.nextAction,
      opportunitySummary: u.opportunitySummary,
    };
  }

  function saveAll() {
    if (!lead || !updates) return;
    const rec = buildRecord();
    addCallRecord(lead.id, rec);
    setStatus(lead.id, updates.suggestedStatus, updates.summary);
    updateLead(lead.id, {
      nextFollowUp: updates.followUpDate ? new Date(updates.followUpDate).toISOString() : lead.nextFollowUp,
      zoomBooked: updates.zoomBooked,
      zoomDate: updates.zoomDate ?? undefined,
      aiSummary: updates.summary,
      aiNextAction: updates.nextAction,
    });
    addNote(lead.id, `📞 ${updates.outcome}\n${updates.summary}\nNext: ${updates.nextAction}`);
    onClose();
  }

  function saveTranscriptOnly() {
    if (!lead) return;
    const rec: CallRecord = updates
      ? buildRecord()
      : {
          id: crypto.randomUUID(),
          leadId: lead.id,
          createdAt: new Date().toISOString(),
          transcript,
          summary: "",
          outcome: "Transcript saved",
          answered: false,
          interested: false,
          suggestedStatus: lead.status,
          followUpDate: null,
          zoomBooked: false,
          zoomDate: null,
          objections: [],
          websitePainPoints: [],
          onlinePresenceNotes: "",
          nextAction: "",
          opportunitySummary: "",
        };
    addCallRecord(lead.id, rec);
    onClose();
  }

  if (!lead) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-[60]"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 260 }}
        className="fixed right-0 top-0 bottom-0 w-full sm:w-[600px] bg-background border-l border-border z-[61] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-background/90 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-maroon">
              <Sparkles className="h-3 w-3" /> AI Call Assistant
            </div>
            <div className="font-display text-xl text-foreground mt-0.5">{lead.business}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {stage === "record" && (
            <>
              {/* Recorder */}
              <div className="rounded-2xl bg-gradient-to-br from-navy/[0.04] to-maroon/[0.04] border border-border p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recording
                  </div>
                  <div className="font-mono text-sm text-foreground">{fmtTime(elapsed)}</div>
                </div>
                <div className="flex items-center gap-3">
                  {!recording ? (
                    <button
                      onClick={startRecording}
                      disabled={permissionDenied}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-maroon text-maroon-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      <Mic className="h-4 w-4" /> Start Recording
                    </button>
                  ) : (
                    <>
                      <button onClick={pauseRecording}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-secondary border border-border text-sm font-medium hover:bg-tan/15">
                        {paused ? <><Play className="h-4 w-4" /> Resume</> : <><Pause className="h-4 w-4" /> Pause</>}
                      </button>
                      <button onClick={stopRecording}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-navy-foreground text-sm font-medium hover:opacity-90">
                        <Square className="h-4 w-4" /> Stop
                      </button>
                      <span className="inline-flex items-center gap-1.5 text-xs text-maroon">
                        <span className="h-2 w-2 rounded-full bg-maroon animate-pulse" />
                        {paused ? "Paused" : "Live"}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground italic mt-3">
                  Real-time transcription isn't connected yet. Stop the recording, then paste or type the call transcript below — the AI will extract structured updates.
                </p>
              </div>

              {/* Transcript box */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" /> Transcript
                  </div>
                  <button
                    onClick={() => setTranscript(MOCK_TRANSCRIPT(lead.business))}
                    className="text-[11px] text-muted-foreground hover:text-navy underline-offset-2 hover:underline"
                  >
                    Insert sample
                  </button>
                </div>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Paste or type the call transcript here…"
                  rows={10}
                  className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm resize-y leading-relaxed font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-secondary border border-border text-sm hover:bg-tan/15">
                  Cancel
                </button>
                <button onClick={processTranscript}
                  disabled={!transcript.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-navy text-navy-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  <Sparkles className="h-4 w-4" /> Summarize with AI
                </button>
              </div>
            </>
          )}

          {stage === "processing" && (
            <div className="rounded-2xl border border-border bg-card p-10 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-navy" />
              <div className="text-sm text-foreground">Analyzing the call…</div>
              <div className="text-xs text-muted-foreground italic">Extracting outcome, status, follow-up, and next actions.</div>
            </div>
          )}

          {stage === "review" && updates && (
            <ReviewForm
              updates={updates}
              setUpdates={setUpdates}
              onSaveAll={saveAll}
              onSaveTranscriptOnly={saveTranscriptOnly}
              onDiscard={onClose}
              onBack={() => setStage("record")}
            />
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}

function ReviewForm({
  updates, setUpdates, onSaveAll, onSaveTranscriptOnly, onDiscard, onBack,
}: {
  updates: Updates;
  setUpdates: (u: Updates) => void;
  onSaveAll: () => void;
  onSaveTranscriptOnly: () => void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  const set = <K extends keyof Updates>(k: K, v: Updates[K]) => setUpdates({ ...updates, [k]: v });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-maroon">
        <Check className="h-3 w-3" /> Review AI updates
      </div>

      {/* Outcome chips */}
      <div className="rounded-2xl bg-gradient-to-br from-tan/15 to-gold/10 border border-tan/40 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Chip label={updates.outcome} tone="navy" />
          {updates.answered && <Chip label="Answered" tone="sage" />}
          {updates.interested && <Chip label="Interested" tone="gold" />}
          {updates.zoomBooked && <Chip label="Zoom booked" tone="maroon" />}
        </div>
        <div>
          <Label>Summary</Label>
          <textarea value={updates.summary} onChange={(e) => set("summary", e.target.value)}
            rows={3} className="w-full mt-1 px-3 py-2 rounded-xl bg-card border border-border text-sm resize-y" />
        </div>
      </div>

      {/* Status & dates */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Suggested Status">
          <select value={updates.suggestedStatus}
            onChange={(e) => set("suggestedStatus", e.target.value as LeadStatus)}
            className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Follow-up date">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <input type="date" value={updates.followUpDate ?? ""}
              onChange={(e) => set("followUpDate", e.target.value || null)}
              className="flex-1 px-3 py-2 rounded-xl bg-card border border-border text-sm" />
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Zoom booked">
          <button
            onClick={() => set("zoomBooked", !updates.zoomBooked)}
            className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              updates.zoomBooked
                ? "bg-maroon text-maroon-foreground"
                : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Video className="h-4 w-4" /> {updates.zoomBooked ? "Yes" : "No"}
          </button>
        </Field>
        <Field label="Zoom date / time">
          <input type="datetime-local"
            value={updates.zoomDate ? updates.zoomDate.slice(0, 16) : ""}
            onChange={(e) => set("zoomDate", e.target.value ? new Date(e.target.value).toISOString() : null)}
            disabled={!updates.zoomBooked}
            className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm disabled:opacity-50" />
        </Field>
      </div>

      <Field label="Next action">
        <input value={updates.nextAction}
          onChange={(e) => set("nextAction", e.target.value)}
          className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm" />
      </Field>

      <Field label="Opportunity summary">
        <textarea value={updates.opportunitySummary}
          onChange={(e) => set("opportunitySummary", e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm resize-y" />
      </Field>

      <ListField label="Objections" items={updates.objections}
        onChange={(v) => set("objections", v)} />

      <ListField label="Website pain points" items={updates.websitePainPoints}
        onChange={(v) => set("websitePainPoints", v)} />

      <Field label="Online presence notes">
        <textarea value={updates.onlinePresenceNotes}
          onChange={(e) => set("onlinePresenceNotes", e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm resize-y" />
      </Field>

      {/* Action bar */}
      <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-background/95 backdrop-blur border-t border-border flex flex-wrap items-center justify-end gap-2">
        <button onClick={onDiscard}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary border border-border text-sm hover:bg-tan/15">
          <Trash2 className="h-4 w-4" /> Discard
        </button>
        <button onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary border border-border text-sm hover:bg-tan/15">
          <Pencil className="h-4 w-4" /> Edit Transcript
        </button>
        <button onClick={onSaveTranscriptOnly}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border text-sm hover:bg-tan/15">
          <FileText className="h-4 w-4" /> Save Transcript Only
        </button>
        <button onClick={onSaveAll}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-navy text-navy-foreground text-sm font-medium hover:opacity-90">
            <Save className="h-4 w-4" /> Save Updates
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
function Chip({ label, tone }: { label: string; tone: "navy" | "maroon" | "sage" | "gold" }) {
  const cls =
    tone === "navy" ? "bg-navy text-navy-foreground" :
    tone === "maroon" ? "bg-maroon text-maroon-foreground" :
    tone === "sage" ? "bg-sage text-sage-foreground" :
    "bg-gold text-gold-foreground";
  return <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${cls}`}>{label}</span>;
}
function ListField({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label}>
      <div className="space-y-1.5">
        {items.length === 0 && <div className="text-xs text-muted-foreground italic">None detected.</div>}
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input value={it}
              onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }}
              className="flex-1 px-3 py-1.5 rounded-lg bg-card border border-border text-sm" />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="px-2 rounded-lg bg-secondary border border-border hover:bg-clay/15">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button onClick={() => onChange([...items, ""])}
          className="text-[11px] text-muted-foreground hover:text-navy underline-offset-2 hover:underline">
          + Add
        </button>
      </div>
    </Field>
  );
}

const MOCK_TRANSCRIPT = (biz: string) => `Me: Hi, is this ${biz}? This is Alex with Northstar Web Design.
Owner: Yeah, this is Mike.
Me: I noticed you don't have a website right now — just your Facebook page. I help local businesses like yours get a clean, fast site that actually shows up on Google. Got two minutes?
Owner: Sure, but I've tried that GoDaddy thing and it was a mess. And I'm not paying hundreds a month.
Me: Totally fair. We do a flat one-time build, then $25/month for hosting. We could hop on Zoom Thursday at 2pm and I'll show you mockups for your business specifically.
Owner: Thursday at 2 works. Send me the link.
Me: Done. I'll follow up Friday morning if I don't hear back. Thanks Mike.`;