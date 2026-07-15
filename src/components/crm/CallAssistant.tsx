import { useEffect, useMemo, useRef, useState } from "react";
import type { CallRecord, CallScript, Lead, LeadStatus } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { STATUSES } from "@/lib/crm-utils";
import {
  getTranscriptionProvider,
  type TranscriptionSession,
  type TranscriptSegment,
} from "@/lib/transcription";

interface Props {
  lead: Lead | null;
  onClose: () => void;
}

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
  contactName: string | null;
  contactRole: string | null;
  followUpReason: string | null;
};

type Stage = "prep" | "live" | "processing" | "confirm";
type Source = "notes" | "transcript";

const MIN_TRANSCRIPT_CHARS = 40;

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function CallAssistant({ lead, onClose }: Props) {
  const updateLead = useLeads((s) => s.updateLead);
  const addCallRecord = useLeads((s) => s.addCallRecord);
  const setStatus = useLeads((s) => s.setStatus);
  const addNote = useLeads((s) => s.addNote);

  function flagBadData(reason: "wrong number" | "business closed" | "no such business") {
    if (!lead) return;
    updateLead(lead.id, {
      unverified: true,
      unverifiedReason: reason,
      verificationTier: "unverified",
      verificationReasons: [`bad data — ${reason}`, "flagged from call"],
      nextFollowUp: undefined,
    });
    setStatus(lead.id, "Not Interested", `Bad data: ${reason}`);
    addNote(lead.id, `⚠ BAD DATA — ${reason.toUpperCase()}`);
    onClose();
  }

  const [stage, setStage] = useState<Stage>("prep");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<Source>("notes");
  const [updates, setUpdates] = useState<Updates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState<CallScript | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const scriptFetchedForRef = useRef<string | null>(null);

  // ── Live-call transcription state ──────────────────────────────────────────
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [micState, setMicState] = useState<"listening" | "paused" | "stopped">("stopped");
  const [transcriptionError, setTranscriptionError] = useState<{
    message: string;
    fatal: boolean;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [scriptCollapsed, setScriptCollapsed] = useState(false);
  const sessionRef = useRef<TranscriptionSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const interimRef = useRef("");

  function stopLive() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Reset when lead changes
  useEffect(() => {
    if (!lead) return;
    stopLive();
    setStage("prep");
    setNotes("");
    setSource("notes");
    setUpdates(null);
    setError(null);
    setScriptError(null);
    setScript(lead.callScript ?? null);
    scriptFetchedForRef.current = lead.id;
    setSegments([]);
    segmentsRef.current = [];
    setInterim("");
    interimRef.current = "";
    setMicState("stopped");
    setTranscriptionError(null);
    setElapsed(0);
    setScriptCollapsed(false);
    pausedRef.current = false;
    // Auto-generate script if enrichment exists but no script yet
    if (!lead.callScript && lead.enrichment) {
      void generateScript(lead, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

  // Stop transcription if the panel unmounts mid-call.
  useEffect(() => {
    return () => stopLive();
  }, []);

  const enrichmentStale = useMemo(() => {
    if (!script?.enrichedAt) return false;
    const enrichedAt = lead?.enrichment?.enrichedAt;
    if (!enrichedAt) return false;
    return new Date(enrichedAt).getTime() > new Date(script.enrichedAt).getTime();
  }, [script, lead?.enrichment?.enrichedAt]);

  async function generateScript(l: Lead, force: boolean) {
    if (!l) return;
    if (!force && l.callScript) {
      setScript(l.callScript);
      return;
    }
    setScriptLoading(true);
    setScriptError(null);
    try {
      const res = await fetch("/api/call-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            business: l.business,
            city: l.city,
            state: l.state,
            phone: l.phone,
            websiteOpportunity: l.websiteOpportunity,
            enrichment: l.enrichment,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setScript(data.script as CallScript);
      updateLead(l.id, { callScript: data.script });
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setScriptLoading(false);
    }
  }

  // ── Live call control ──────────────────────────────────────────────────────
  async function startListening() {
    if (!lead) return;
    setError(null);
    const provider = getTranscriptionProvider();
    if (!provider) {
      setError("Live transcription needs Chrome or Edge. Type your notes below instead.");
      return;
    }
    setSegments([]);
    segmentsRef.current = [];
    setInterim("");
    interimRef.current = "";
    setTranscriptionError(null);
    setElapsed(0);
    setScriptCollapsed(false);
    pausedRef.current = false;
    setStage("live");
    try {
      const session = await provider.start({
        onSegment: (s) => {
          segmentsRef.current = [...segmentsRef.current, s];
          setSegments(segmentsRef.current);
          interimRef.current = "";
          setInterim("");
        },
        onInterim: (text) => {
          interimRef.current = text;
          setInterim(text);
        },
        onError: (e) => {
          setTranscriptionError({ message: e.message, fatal: e.fatal });
          if (e.fatal) {
            stopLive();
            setMicState("stopped");
          }
        },
        onStateChange: (st) => setMicState(st),
      });
      sessionRef.current = session;
      timerRef.current = setInterval(() => {
        if (!pausedRef.current) setElapsed((e) => e + 1);
      }, 1000);
    } catch (e) {
      // Mic denied or provider failed to start — fall back to typed notes.
      setStage("prep");
      setError(e instanceof Error ? e.message : "Could not start transcription.");
    }
  }

  function pauseListening() {
    pausedRef.current = true;
    sessionRef.current?.pause();
  }
  function resumeListening() {
    pausedRef.current = false;
    sessionRef.current?.resume();
  }

  function buildTranscript(): string {
    const finalText = segmentsRef.current.map((s) => s.text).join(" ");
    const tail = interimRef.current.trim();
    return (tail ? `${finalText} ${tail}` : finalText).trim();
  }

  function endCall() {
    stopLive();
    setMicState("stopped");
    const transcript = buildTranscript();
    setNotes(transcript);
    setSource("transcript");
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      // Too little captured — likely a botched recording. Preserve what we have
      // in the notes box and let them type or retry.
      setStage("prep");
      setError("Not much was captured. Review or type the notes, then structure the outcome.");
      return;
    }
    void runSummarize(transcript, "transcript");
  }

  // From a fatal mid-call error: keep the transcript, drop into typed notes.
  function continueTyping() {
    stopLive();
    setMicState("stopped");
    const transcript = buildTranscript();
    setNotes(transcript);
    setSource("notes");
    setStage("prep");
  }

  async function runSummarize(text: string, src: Source) {
    if (!lead) return;
    const trimmed = text.trim();
    if (trimmed.length < 10) {
      setError("Add at least a sentence of notes before summarizing.");
      setStage("prep");
      return;
    }
    setStage("processing");
    setError(null);
    try {
      const res = await fetch("/api/summarize-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: trimmed,
          lead: {
            business: lead.business,
            city: lead.city,
            state: lead.state,
            websiteOpportunity: lead.websiteOpportunity,
          },
          callSignals: { source: src, elapsedSeconds: elapsed || undefined },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      const u = data.updates as Partial<Updates>;
      setUpdates({
        summary: u.summary ?? "",
        outcome: u.outcome ?? "",
        answered: !!u.answered,
        interested: !!u.interested,
        suggestedStatus: (STATUSES as readonly string[]).includes(u.suggestedStatus as string)
          ? (u.suggestedStatus as LeadStatus)
          : lead.status,
        followUpDate: u.followUpDate ?? null,
        zoomBooked: !!u.zoomBooked,
        zoomDate: u.zoomDate ?? null,
        objections: u.objections ?? [],
        websitePainPoints: u.websitePainPoints ?? [],
        onlinePresenceNotes: u.onlinePresenceNotes ?? "",
        nextAction: u.nextAction ?? "",
        opportunitySummary: u.opportunitySummary ?? "",
        contactName: u.contactName ?? null,
        contactRole: u.contactRole ?? null,
        followUpReason: u.followUpReason ?? null,
      });
      setStage("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("prep");
    }
  }

  function summarizeNotes() {
    void runSummarize(notes, source);
  }

  function confirmAndSave() {
    if (!lead || !updates) return;
    const contactName = updates.contactName?.trim() || undefined;
    const record: CallRecord = {
      id: crypto.randomUUID(),
      leadId: lead.id,
      createdAt: new Date().toISOString(),
      transcript: notes,
      source,
      summary: updates.summary,
      outcome: updates.outcome,
      answered: updates.answered,
      interested: updates.interested,
      suggestedStatus: updates.suggestedStatus,
      followUpDate: updates.followUpDate,
      zoomBooked: updates.zoomBooked,
      zoomDate: updates.zoomDate,
      objections: updates.objections,
      websitePainPoints: updates.websitePainPoints,
      onlinePresenceNotes: updates.onlinePresenceNotes,
      nextAction: updates.nextAction,
      opportunitySummary: updates.opportunitySummary,
      contactName,
      contactRole: updates.contactRole?.trim() || undefined,
      followUpReason: updates.followUpReason?.trim() || undefined,
    };
    addCallRecord(lead.id, record);
    setStatus(lead.id, updates.suggestedStatus, updates.summary);
    const leadPatch: Partial<Lead> = {
      nextFollowUp: updates.followUpDate
        ? new Date(updates.followUpDate).toISOString()
        : lead.nextFollowUp,
      zoomBooked: updates.zoomBooked,
      zoomDate: updates.zoomDate ?? undefined,
      aiSummary: updates.summary,
      aiNextAction: updates.nextAction,
    };
    // Capture who we spoke to onto the lead if we don't already know an owner.
    if (contactName && !lead.owner?.trim()) {
      leadPatch.owner = contactName;
      leadPatch.ownerSource = "call";
    }
    updateLead(lead.id, leadPatch);
    addNote(lead.id, `📞 ${updates.outcome}\n${updates.summary}\nNext: ${updates.nextAction}`);
    onClose();
  }

  if (!lead) return null;

  return (
    <>
      <div className="fixed inset-0 bg-foreground/30 z-[60]" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-full sm:w-[640px] bg-background border-l border-border z-[61] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mono text-muted-foreground">— CALL ASSISTANT —</div>
            <div className="font-display text-2xl text-foreground mt-1 truncate">
              {lead.business}
            </div>
            <div className="mono text-muted-foreground mt-1 truncate">
              {lead.city}, {lead.state}
              {lead.phone ? ` — ${lead.phone}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="mono ink-link shrink-0">
            [ CLOSE ]
          </button>
        </div>

        <div className="px-6 py-6 space-y-8">
          {error && (
            <div className="mono text-[color:var(--sienna)] border border-[color:var(--sienna)] px-3 py-2">
              ⚠ {error}
            </div>
          )}

          {/* SECTION: SCRIPT — hidden while confirming; collapsible while live */}
          {stage !== "confirm" && (
            <ScriptSection
              lead={lead}
              script={script}
              scriptLoading={scriptLoading}
              scriptError={scriptError}
              enrichmentStale={enrichmentStale}
              onGenerate={() => generateScript(lead, true)}
              collapsible={stage === "live"}
              collapsed={scriptCollapsed}
              onToggleCollapsed={() => setScriptCollapsed((c) => !c)}
            />
          )}

          {stage === "prep" && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between border-b border-border pb-2">
                <div className="mono text-foreground">— CALL NOTES —</div>
                <SourceToggle source={source} setSource={setSource} />
              </div>

              {/* Live-call launcher */}
              <button
                onClick={startListening}
                className="w-full mono px-4 py-3 border border-[color:var(--sienna)] text-[color:var(--sienna)] hover:bg-[color:var(--sienna)] hover:text-background transition-colors flex items-center justify-center gap-2"
              >
                <span className="text-lg leading-none">●</span> START LISTENING — LIVE CALL
              </button>
              <p className="mono text-muted-foreground text-center">
                Transcribes both sides on speakerphone. Or type notes below.
              </p>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Type or paste rough notes from the call — who you spoke to, what they said, objections, next step…"
                rows={10}
                className="w-full bg-transparent border border-border p-3 mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground resize-y"
                style={{ fontSize: "12px", lineHeight: 1.55 }}
              />
              <div className="flex items-center justify-end gap-4">
                <button onClick={onClose} className="mono ink-link">
                  [ CANCEL ]
                </button>
                <button
                  onClick={summarizeNotes}
                  disabled={notes.trim().length < 10}
                  className="mono px-4 py-2 bg-foreground text-background disabled:opacity-40"
                >
                  [ STRUCTURE OUTCOME ]
                </button>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <div className="mono text-muted-foreground mb-2">— BAD DATA —</div>
                <p className="mono text-muted-foreground mb-2">
                  Flag this lead as unverified and drop it from TODAY.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => flagBadData("wrong number")}
                    className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-2 py-1 hover:bg-[color:var(--sienna)] hover:text-background"
                  >
                    [ WRONG NUMBER ]
                  </button>
                  <button
                    onClick={() => flagBadData("business closed")}
                    className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-2 py-1 hover:bg-[color:var(--sienna)] hover:text-background"
                  >
                    [ BUSINESS CLOSED ]
                  </button>
                  <button
                    onClick={() => flagBadData("no such business")}
                    className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-2 py-1 hover:bg-[color:var(--sienna)] hover:text-background"
                  >
                    [ NO SUCH BUSINESS ]
                  </button>
                </div>
              </div>
            </section>
          )}

          {stage === "live" && (
            <LiveCall
              segments={segments}
              interim={interim}
              micState={micState}
              elapsed={elapsed}
              transcriptionError={transcriptionError}
              onPause={pauseListening}
              onResume={resumeListening}
              onEnd={endCall}
              onContinueTyping={continueTyping}
            />
          )}

          {stage === "processing" && (
            <div className="mono text-muted-foreground py-12 text-center border border-dashed border-border">
              — reading the call · structuring outcome —
            </div>
          )}

          {stage === "confirm" && updates && (
            <ConfirmPanel
              updates={updates}
              setUpdates={setUpdates}
              currentStatus={lead.status}
              onBack={() => setStage("prep")}
              onConfirm={confirmAndSave}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function ScriptSection({
  lead,
  script,
  scriptLoading,
  scriptError,
  enrichmentStale,
  onGenerate,
  collapsible,
  collapsed,
  onToggleCollapsed,
}: {
  lead: Lead;
  script: CallScript | null;
  scriptLoading: boolean;
  scriptError: string | null;
  enrichmentStale: boolean;
  onGenerate: () => void;
  collapsible: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <button
          onClick={collapsible ? onToggleCollapsed : undefined}
          className={`mono text-foreground ${collapsible ? "hover:opacity-70" : "cursor-default"}`}
        >
          — PRE-CALL SCRIPT — {collapsible && (collapsed ? "[ SHOW ]" : "[ HIDE ]")}
        </button>
        <div className="flex items-center gap-4">
          {enrichmentStale && <span className="mono text-[color:var(--sienna)]">STALE</span>}
          <button
            onClick={onGenerate}
            disabled={scriptLoading}
            className="mono ink-link disabled:opacity-50"
          >
            {scriptLoading ? "[ WRITING… ]" : script ? "[ REGENERATE ]" : "[ GENERATE SCRIPT ]"}
          </button>
        </div>
      </div>

      {collapsible && collapsed ? null : (
        <>
          {scriptError && <div className="mono text-[color:var(--sienna)]">⚠ {scriptError}</div>}

          {!script && !scriptLoading && !scriptError && (
            <div className="mono text-muted-foreground py-6 text-center border border-dashed border-border">
              — no script yet —
              {!lead.enrichment && (
                <div className="mt-2">RESEARCH THIS LEAD FIRST FOR A TAILORED SCRIPT</div>
              )}
            </div>
          )}

          {scriptLoading && !script && (
            <div className="mono text-muted-foreground py-6 text-center border border-dashed border-border">
              — drafting a tailored script —
            </div>
          )}

          {script && (
            <div className="space-y-5">
              <ScriptBlock label="OPENER" body={script.opener} />
              <ScriptBlock label="PITCH ANGLE" body={script.pitchAngle} accent />
              <div>
                <div className="mono text-muted-foreground mb-2">DISCOVERY</div>
                <ol className="space-y-2">
                  {script.discovery.map((q, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mono text-muted-foreground shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="font-serif text-foreground leading-snug">{q}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <div className="mono text-muted-foreground mb-2">LIKELY OBJECTIONS</div>
                <div className="divide-y divide-border border-y border-border">
                  {script.objections.map((o, i) => (
                    <div key={i} className="py-3">
                      <div className="mono text-foreground">→ {o.objection}</div>
                      <p className="font-serif text-foreground mt-1 leading-snug">{o.response}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LiveCall({
  segments,
  interim,
  micState,
  elapsed,
  transcriptionError,
  onPause,
  onResume,
  onEnd,
  onContinueTyping,
}: {
  segments: TranscriptSegment[];
  interim: string;
  micState: "listening" | "paused" | "stopped";
  elapsed: number;
  transcriptionError: { message: string; fatal: boolean } | null;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onContinueTyping: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [segments, interim]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  const fatal = transcriptionError?.fatal;

  return (
    <section className="space-y-3">
      {/* Sticky live control strip */}
      <div className="sticky top-[89px] z-10 -mx-6 px-6 py-3 bg-background border-y border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`mono flex items-center gap-1.5 ${
              micState === "listening" ? "text-[color:var(--sienna)]" : "text-muted-foreground"
            }`}
          >
            <span className={micState === "listening" ? "animate-pulse" : ""}>●</span>
            {micState === "listening" ? "LIVE" : micState === "paused" ? "PAUSED" : "STOPPED"}
          </span>
          <span className="mono text-foreground tabular-nums">{fmtElapsed(elapsed)}</span>
        </div>
        <div className="flex items-center gap-3">
          {!fatal &&
            (micState === "paused" ? (
              <button onClick={onResume} className="mono ink-link">
                [ RESUME ]
              </button>
            ) : (
              <button onClick={onPause} className="mono ink-link">
                [ PAUSE ]
              </button>
            ))}
          <button onClick={onEnd} className="mono px-3 py-1.5 bg-foreground text-background">
            [ END CALL ]
          </button>
        </div>
      </div>

      <div className="mono text-muted-foreground text-center">
        SPEAKERPHONE NEXT TO THE MIC — BOTH VOICES ARE CAPTURED
      </div>

      {transcriptionError && (
        <div
          className={`mono px-3 py-2 border ${
            fatal
              ? "text-[color:var(--sienna)] border-[color:var(--sienna)]"
              : "text-muted-foreground border-border"
          }`}
        >
          ⚠ {transcriptionError.message}
          {fatal && (
            <div className="mt-2">
              Your transcript is safe below.{" "}
              <button onClick={onContinueTyping} className="ink-link">
                [ CONTINUE TYPING ]
              </button>
            </div>
          )}
        </div>
      )}

      {/* Transcript pane */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="border border-border p-4 max-h-[46vh] overflow-y-auto space-y-3"
      >
        {segments.length === 0 && !interim && (
          <div className="mono text-muted-foreground text-center py-8">
            — listening · start talking —
          </div>
        )}
        {segments.map((s, i) => (
          <div key={i} className="grid grid-cols-[3.5rem_1fr] gap-3">
            <span className="mono text-muted-foreground pt-1">{fmtClock(s.at)}</span>
            <p className="font-serif text-foreground leading-snug" style={{ fontSize: "1rem" }}>
              {s.text}
            </p>
          </div>
        ))}
        {interim && (
          <div className="grid grid-cols-[3.5rem_1fr] gap-3">
            <span className="mono text-muted-foreground pt-1">···</span>
            <p
              className="font-serif text-muted-foreground italic leading-snug"
              style={{ fontSize: "1rem" }}
            >
              {interim}
            </p>
          </div>
        )}
      </div>
      <div className="mono text-muted-foreground text-right">
        [ END CALL ] STOPS THE MIC AND STRUCTURES THE OUTCOME
      </div>
    </section>
  );
}

function SourceToggle({ source, setSource }: { source: Source; setSource: (s: Source) => void }) {
  return (
    <div className="mono text-muted-foreground flex items-center gap-2">
      <span>SOURCE</span>
      {(["notes", "transcript"] as const).map((s) => (
        <button
          key={s}
          onClick={() => setSource(s)}
          className={`px-2 py-0.5 border ${
            source === s
              ? "border-foreground text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function ScriptBlock({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div>
      <div className="mono text-muted-foreground mb-1.5">{label}</div>
      <p
        className={`font-serif leading-snug ${
          accent ? "text-[color:var(--sienna)]" : "text-foreground"
        }`}
        style={{ fontSize: "1.05rem" }}
      >
        {body}
      </p>
    </div>
  );
}

function ConfirmPanel({
  updates,
  setUpdates,
  currentStatus,
  onBack,
  onConfirm,
}: {
  updates: Updates;
  setUpdates: (u: Updates) => void;
  currentStatus: LeadStatus;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const set = <K extends keyof Updates>(k: K, v: Updates[K]) => setUpdates({ ...updates, [k]: v });
  const statusChanging = updates.suggestedStatus !== currentStatus;
  const positiveStatuses: LeadStatus[] = ["Zoom Booked", "Sold", "Callback Scheduled"];
  const isPositive = updates.interested || positiveStatuses.includes(updates.suggestedStatus);
  const followUpMissingReason = !!updates.followUpDate && !updates.followUpReason?.trim();

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <div className="mono text-foreground">— STRUCTURED OUTCOME —</div>
        <div className="mono text-muted-foreground">CONFIRM TO APPLY</div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Row label="SPOKE WITH">
          <input
            value={updates.contactName ?? ""}
            onChange={(e) => set("contactName", e.target.value || null)}
            placeholder="e.g. Mike"
            className="w-full bg-transparent border border-border p-2 mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
        </Row>
        <Row label="THEIR ROLE">
          <input
            value={updates.contactRole ?? ""}
            onChange={(e) => set("contactRole", e.target.value || null)}
            placeholder="e.g. owner"
            className="w-full bg-transparent border border-border p-2 mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
        </Row>
      </div>

      <Row label="WHAT HAPPENED">
        <textarea
          value={updates.summary}
          onChange={(e) => set("summary", e.target.value)}
          rows={3}
          className="w-full bg-transparent border border-border p-2 font-serif text-foreground focus:outline-none focus:border-foreground resize-y"
          style={{ fontSize: "0.95rem", lineHeight: 1.5 }}
        />
      </Row>

      <Row label="OUTCOME">
        <input
          value={updates.outcome}
          onChange={(e) => set("outcome", e.target.value)}
          className={`w-full bg-transparent border p-2 mono focus:outline-none focus:border-foreground ${
            isPositive
              ? "border-[color:var(--frog-ink)] text-[color:var(--frog-ink)]"
              : "border-border text-foreground"
          }`}
          style={{ fontSize: "12px" }}
        />
        <div className="flex flex-wrap gap-3 mt-2 mono text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={updates.answered}
              onChange={(e) => set("answered", e.target.checked)}
            />
            ANSWERED
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={updates.interested}
              onChange={(e) => set("interested", e.target.checked)}
            />
            INTERESTED
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={updates.zoomBooked}
              onChange={(e) => set("zoomBooked", e.target.checked)}
            />
            ZOOM BOOKED
          </label>
        </div>
      </Row>

      <Row label="OBJECTIONS">
        <ListEditor
          items={updates.objections}
          onChange={(v) => set("objections", v)}
          placeholder="e.g. Too expensive"
        />
      </Row>

      <Row label="NEXT ACTION">
        <input
          value={updates.nextAction}
          onChange={(e) => set("nextAction", e.target.value)}
          className="w-full bg-transparent border border-border p-2 mono text-foreground focus:outline-none focus:border-foreground"
          style={{ fontSize: "12px" }}
        />
      </Row>

      <div className="grid grid-cols-2 gap-4">
        <Row label="FOLLOW-UP DATE">
          <input
            type="date"
            value={updates.followUpDate ?? ""}
            onChange={(e) => set("followUpDate", e.target.value || null)}
            className="w-full bg-transparent border border-border p-2 mono text-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
        </Row>
        <Row
          label={
            <span className={followUpMissingReason ? "text-[color:var(--sienna)]" : ""}>
              WHY THIS FOLLOW-UP {followUpMissingReason ? "(ADD ONE)" : ""}
            </span>
          }
        >
          <input
            value={updates.followUpReason ?? ""}
            onChange={(e) => set("followUpReason", e.target.value || null)}
            placeholder="e.g. wants pricing after Aug"
            className={`w-full bg-transparent border p-2 mono focus:outline-none focus:border-foreground ${
              followUpMissingReason
                ? "border-[color:var(--sienna)] text-foreground"
                : "border-border text-foreground"
            }`}
            style={{ fontSize: "12px" }}
          />
        </Row>
      </div>

      <Row
        label={
          <span className={statusChanging ? "text-[color:var(--sienna)]" : ""}>
            NEW STATUS {statusChanging ? "(CHANGING)" : ""}
          </span>
        }
      >
        <select
          value={updates.suggestedStatus}
          onChange={(e) => set("suggestedStatus", e.target.value as LeadStatus)}
          className={`w-full bg-transparent border p-2 mono focus:outline-none focus:border-foreground ${
            statusChanging
              ? "border-[color:var(--sienna)] text-[color:var(--sienna)]"
              : "border-border text-foreground"
          }`}
          style={{ fontSize: "12px" }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="mono text-muted-foreground mt-1">
          CURRENT: {currentStatus.toUpperCase()}
        </div>
      </Row>

      {updates.zoomBooked && (
        <Row label="ZOOM DATE / TIME">
          <input
            type="datetime-local"
            value={updates.zoomDate ? updates.zoomDate.slice(0, 16) : ""}
            onChange={(e) =>
              set("zoomDate", e.target.value ? new Date(e.target.value).toISOString() : null)
            }
            className="w-full bg-transparent border border-border p-2 mono text-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
        </Row>
      )}

      <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-background border-t border-border flex items-center justify-end gap-4">
        <button onClick={onBack} className="mono ink-link">
          [ ← EDIT NOTES ]
        </button>
        <button onClick={onConfirm} className="mono px-4 py-2 bg-foreground text-background">
          [ CONFIRM & APPLY ]
        </button>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mono text-muted-foreground mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <div className="mono text-muted-foreground italic">NONE</div>}
      {items.map((it, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={it}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent border border-border p-1.5 mono text-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="mono border border-border px-2 text-muted-foreground hover:text-[color:var(--sienna)] hover:border-[color:var(--sienna)]"
          >
            ×
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ""])} className="mono ink-link">
        [ + ADD ]
      </button>
    </div>
  );
}
