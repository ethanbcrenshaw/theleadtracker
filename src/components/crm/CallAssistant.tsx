import { useEffect, useMemo, useRef, useState } from "react";
import type { CallRecord, CallScript, Lead, LeadStatus } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { STATUSES } from "@/lib/crm-utils";

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
};

type Stage = "prep" | "processing" | "confirm";
type Source = "notes" | "transcript";

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

  // Reset when lead changes
  useEffect(() => {
    if (!lead) return;
    setStage("prep");
    setNotes("");
    setSource("notes");
    setUpdates(null);
    setError(null);
    setScriptError(null);
    setScript(lead.callScript ?? null);
    scriptFetchedForRef.current = lead.id;
    // Auto-generate script if enrichment exists but no script yet
    if (!lead.callScript && lead.enrichment) {
      void generateScript(lead, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id]);

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

  async function summarize() {
    if (!lead) return;
    const text = notes.trim();
    if (text.length < 10) {
      setError("Add at least a sentence of notes before summarizing.");
      return;
    }
    setStage("processing");
    setError(null);
    try {
      const res = await fetch("/api/summarize-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          lead: {
            business: lead.business,
            city: lead.city,
            state: lead.state,
            websiteOpportunity: lead.websiteOpportunity,
          },
          callSignals: { source },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      setUpdates({
        ...data.updates,
        suggestedStatus: (STATUSES as readonly string[]).includes(data.updates.suggestedStatus)
          ? data.updates.suggestedStatus
          : lead.status,
      });
      setStage("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStage("prep");
    }
  }

  function confirmAndSave() {
    if (!lead || !updates) return;
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
    };
    addCallRecord(lead.id, record);
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

  if (!lead) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-foreground/30 z-[60]"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 bottom-0 w-full sm:w-[640px] bg-background border-l border-border z-[61] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mono text-muted-foreground">— CALL ASSISTANT —</div>
            <div className="font-display text-2xl text-foreground mt-1 truncate">{lead.business}</div>
            <div className="mono text-muted-foreground mt-1 truncate">
              {lead.city}, {lead.state}{lead.phone ? ` — ${lead.phone}` : ""}
            </div>
          </div>
          <button onClick={onClose} className="mono ink-link shrink-0">[ CLOSE ]</button>
        </div>

        <div className="px-6 py-6 space-y-8">
          {error && (
            <div className="mono text-[color:var(--sienna)] border border-[color:var(--sienna)] px-3 py-2">
              ⚠ {error}
            </div>
          )}

          {/* SECTION: SCRIPT */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-border pb-2">
              <div className="mono text-foreground">— PRE-CALL SCRIPT —</div>
              <div className="flex items-center gap-4">
                {enrichmentStale && (
                  <span className="mono text-[color:var(--sienna)]">STALE</span>
                )}
                <button
                  onClick={() => generateScript(lead, true)}
                  disabled={scriptLoading}
                  className="mono ink-link disabled:opacity-50"
                >
                  {scriptLoading
                    ? "[ WRITING… ]"
                    : script
                      ? "[ REGENERATE ]"
                      : "[ GENERATE SCRIPT ]"}
                </button>
              </div>
            </div>

            {scriptError && (
              <div className="mono text-[color:var(--sienna)]">⚠ {scriptError}</div>
            )}

            {!script && !scriptLoading && !scriptError && (
              <div className="mono text-muted-foreground py-6 text-center border border-dashed border-border">
                — no script yet —
                {!lead.enrichment && <div className="mt-2">RESEARCH THIS LEAD FIRST FOR A TAILORED SCRIPT</div>}
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
                        <span className="mono text-muted-foreground shrink-0">{String(i + 1).padStart(2, "0")}</span>
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
          </section>

          {stage === "prep" && (
            <>
              {/* SECTION: NOTES */}
              <section className="space-y-3">
                <div className="flex items-baseline justify-between border-b border-border pb-2">
                  <div className="mono text-foreground">— CALL NOTES —</div>
                  <div className="flex items-center gap-3">
                    <SourceToggle source={source} setSource={setSource} />
                  </div>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Type or paste rough notes from the call — who you spoke to, what they said, objections, next step…"
                  rows={10}
                  className="w-full bg-transparent border border-border p-3 mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground resize-y"
                  style={{ fontSize: "12px", lineHeight: 1.55 }}
                />
                <div className="flex items-center justify-end gap-4">
                  <button onClick={onClose} className="mono ink-link">[ CANCEL ]</button>
                  <button
                    onClick={summarize}
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
                    >[ WRONG NUMBER ]</button>
                    <button
                      onClick={() => flagBadData("business closed")}
                      className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-2 py-1 hover:bg-[color:var(--sienna)] hover:text-background"
                    >[ BUSINESS CLOSED ]</button>
                    <button
                      onClick={() => flagBadData("no such business")}
                      className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-2 py-1 hover:bg-[color:var(--sienna)] hover:text-background"
                    >[ NO SUCH BUSINESS ]</button>
                  </div>
                </div>
              </section>
            </>
          )}

          {stage === "processing" && (
            <div className="mono text-muted-foreground py-12 text-center border border-dashed border-border">
              — reading notes · structuring outcome —
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

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <div className="mono text-foreground">— STRUCTURED OUTCOME —</div>
        <div className="mono text-muted-foreground">CONFIRM TO APPLY</div>
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
          className="w-full bg-transparent border border-border p-2 mono text-foreground focus:outline-none focus:border-foreground"
          style={{ fontSize: "12px" }}
        />
        <div className="flex flex-wrap gap-3 mt-2 mono text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={updates.answered} onChange={(e) => set("answered", e.target.checked)} />
            ANSWERED
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={updates.interested} onChange={(e) => set("interested", e.target.checked)} />
            INTERESTED
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={updates.zoomBooked} onChange={(e) => set("zoomBooked", e.target.checked)} />
            ZOOM BOOKED
          </label>
        </div>
      </Row>

      <Row label="OBJECTIONS">
        <ListEditor items={updates.objections} onChange={(v) => set("objections", v)} placeholder="e.g. Too expensive" />
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
            <span className={statusChanging ? "text-[color:var(--sienna)]" : ""}>
              NEW STATUS {statusChanging ? "(CHANGING)" : ""}
            </span>
          }
        >
          <select
            value={updates.suggestedStatus}
            onChange={(e) => set("suggestedStatus", e.target.value as LeadStatus)}
            className={`w-full bg-transparent border p-2 mono focus:outline-none focus:border-foreground ${
              statusChanging ? "border-[color:var(--sienna)] text-[color:var(--sienna)]" : "border-border text-foreground"
            }`}
            style={{ fontSize: "12px" }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="mono text-muted-foreground mt-1">CURRENT: {currentStatus.toUpperCase()}</div>
        </Row>
      </div>

      {updates.zoomBooked && (
        <Row label="ZOOM DATE / TIME">
          <input
            type="datetime-local"
            value={updates.zoomDate ? updates.zoomDate.slice(0, 16) : ""}
            onChange={(e) => set("zoomDate", e.target.value ? new Date(e.target.value).toISOString() : null)}
            className="w-full bg-transparent border border-border p-2 mono text-foreground focus:outline-none focus:border-foreground"
            style={{ fontSize: "12px" }}
          />
        </Row>
      )}

      <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-background border-t border-border flex items-center justify-end gap-4">
        <button onClick={onBack} className="mono ink-link">[ ← EDIT NOTES ]</button>
        <button
          onClick={onConfirm}
          className="mono px-4 py-2 bg-foreground text-background"
        >
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
      <button
        onClick={() => onChange([...items, ""])}
        className="mono ink-link"
      >
        [ + ADD ]
      </button>
    </div>
  );
}