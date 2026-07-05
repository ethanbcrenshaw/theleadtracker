import { X, ArrowLeft, PhoneCall, Voicemail, Video, CalendarClock, CheckCircle2, XCircle, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Lead, LeadEnrichment, LeadProfileType, LeadStatus, WebsiteOpportunity } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { StatusBadge, TagBadge } from "./Badges";
import { formatDate, normalizeTag, pitchAngle, sourceLinks } from "@/lib/crm-utils";
import { AddLeadSheet } from "./AddLeadSheet";

interface Props {
  lead: Lead | null;
  onClose: () => void;
  onStartCall?: (lead: Lead) => void;
  inline?: boolean;
  backLabel?: string;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function opportunityShort(op: WebsiteOpportunity): string {
  switch (op) {
    case "No Dedicated Website": return "No website";
    case "Facebook Only": return "Facebook only";
    case "Yelp/Directory Only": return "Directory only";
    case "Outdated Website": return "Outdated site";
    case "Has Website": return "Has website";
    case "Social-Heavy": return "Social-heavy";
  }
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

export function LeadDetail({ lead, onClose, onStartCall, inline, backLabel }: Props) {
  const setStatus = useLeads((s) => s.setStatus);
  const addNote = useLeads((s) => s.addNote);
  const updateLead = useLeads((s) => s.updateLead);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");

  useEffect(() => {
    setNote("");
    setFollowUp(lead?.nextFollowUp ? lead.nextFollowUp.slice(0, 10) : "");
  }, [lead?.id]);

  if (inline) {
    if (!lead) {
      return (
        <div className="h-full grid place-items-center mono text-muted-foreground p-8 text-center">
          — select a lead from the list —
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto">
        <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3 min-w-0">
            {backLabel && (
              <button onClick={onClose} className="mono lg:hidden ink-link">
                {backLabel}
              </button>
            )}
            <span className="mono text-muted-foreground">
              RANK {String(lead.priority).padStart(3, "0")}
            </span>
          </div>
        </div>
        <DetailBody
          lead={lead}
          onStartCall={onStartCall}
          setStatus={setStatus}
          updateLead={updateLead}
          addNote={addNote}
          note={note}
          setNote={setNote}
          followUp={followUp}
          setFollowUp={setFollowUp}
        />
      </div>
    );
  }

  return (
    <AnimatePresence>
      {lead && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[580px] bg-background border-l border-foreground z-50 overflow-y-auto"
          >
            <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between z-10">
              <span className="mono text-muted-foreground">RANK {String(lead.priority).padStart(3, "0")}</span>
              <div className="flex items-center gap-3">
                <button onClick={onClose} className="mono text-muted-foreground hover:text-foreground">[ ESC ]</button>
                <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-foreground/10">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <DetailBody
              lead={lead}
              onStartCall={onStartCall}
              setStatus={setStatus}
              updateLead={updateLead}
              addNote={addNote}
              note={note}
              setNote={setNote}
              followUp={followUp}
              setFollowUp={setFollowUp}
            />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DetailBody({
  lead,
  onStartCall,
  setStatus,
  updateLead,
  addNote,
  note,
  setNote,
  followUp,
  setFollowUp,
}: {
  lead: Lead;
  onStartCall?: (lead: Lead) => void;
  setStatus: (id: string, s: LeadStatus) => void;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  addNote: (id: string, note: string) => void;
  note: string;
  setNote: (v: string) => void;
  followUp: string;
  setFollowUp: (v: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  return (
    <div className="p-6 space-y-8">
              <LeadHero
                lead={lead}
                onStartCall={onStartCall}
                onEdit={() => setEditOpen(true)}
              />
              <Dossier lead={lead} updateLead={updateLead} />
              <OutcomeActions
                lead={lead}
                setStatus={setStatus}
                updateLead={updateLead}
              />
              <NotesBlock
                lead={lead}
                note={note}
                setNote={setNote}
                addNote={addNote}
              />
              <TagsBlock lead={lead} updateLead={updateLead} />

              {(lead.aiSummary || lead.aiNextAction) && (
                <div className="border-t border-border pt-4">
                  <div className="mono text-muted-foreground mb-2">— AI Notes · latest call</div>
                  {lead.aiSummary && <p className="text-sm text-foreground/90 leading-relaxed">{lead.aiSummary}</p>}
                  {lead.aiNextAction && (
                    <div className="mt-2 text-xs text-foreground/80">
                      <span className="mono text-[color:var(--sienna)]">NEXT —</span> {lead.aiNextAction}
                    </div>
                  )}
                </div>
              )}

              {lead.owner && (
                <div className="border-t border-border pt-4">
                  <div className="mono text-muted-foreground mb-2">— Owner</div>
                  <div className="font-display text-2xl text-foreground">{lead.owner}</div>
                  {lead.ownerSource && (
                    <a
                      href={lead.ownerSource.split(/[ ,&]+http/)[0].startsWith("http") ? lead.ownerSource.split(/\s|,/)[0] : "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono ink-link mt-2 inline-block"
                    >
                      [ SOURCE ]
                    </a>
                  )}
                </div>
              )}

              <div className="border-t border-border pt-4">
                <div className="mono text-muted-foreground mb-2">— Online Presence</div>
                <p className="text-sm text-foreground/90">{lead.onlinePresence}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {lead.sources.map((s) => (
                    <span key={s} className="mono border border-border px-1.5 py-1 text-muted-foreground">{s}</span>
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mono text-muted-foreground mb-2">— Find Them Online</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border-t border-border">
                  {sourceLinks(lead).map((link) => (
                    <a
                      key={link.source + link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 border-b border-r border-border px-3 py-3 hover:bg-foreground/[0.04] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{link.label}</div>
                        <div className="mono text-muted-foreground truncate">{link.domain}</div>
                      </div>
                      <span className="mono text-muted-foreground">[ OPEN ]</span>
                    </a>
                  ))}
                </div>
                <div className="mono text-muted-foreground mt-2">
                  Links search by business + city — opens the most likely profile.
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mono text-muted-foreground mb-2">— Manual Follow-Up Override</div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    className="flex-1 px-3 py-2 border border-border bg-transparent text-sm"
                  />
                  <button
                    onClick={() => updateLead(lead.id, { nextFollowUp: followUp ? new Date(followUp).toISOString() : undefined })}
                    className="mono px-4 py-2 bg-foreground text-background hover:opacity-90"
                  >
                    [ SAVE ]
                  </button>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="mono text-muted-foreground mb-3">— Contact History</div>
                {lead.history.length === 0 ? (
                  <div className="mono text-muted-foreground">— no contact yet — start with a call —</div>
                ) : (
                  <div className="space-y-2">
                    {[...lead.history].reverse().map((h) => (
                      <div key={h.id} className="border border-border p-3">
                        <div className="flex items-center justify-between">
                          <StatusBadge s={h.status} />
                          <span className="mono text-muted-foreground">{formatDate(h.date)}</span>
                        </div>
                        {h.note && <p className="text-xs text-foreground/80 mt-1">{h.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {lead.callRecords && lead.callRecords.length > 0 && (
                <div className="border-t border-border pt-4">
                  <div className="mono text-muted-foreground mb-3">— Call Recordings & Summaries</div>
                  <div className="space-y-2">
                    {[...lead.callRecords].reverse().map((c) => (
                      <details key={c.id} className="border border-border p-3">
                        <summary className="cursor-pointer flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">{c.outcome}</span>
                          <span className="mono text-muted-foreground">{formatDate(c.createdAt)}</span>
                        </summary>
                        {c.summary && <p className="mt-2 text-sm text-foreground/90">{c.summary}</p>}
                        {c.nextAction && (
                          <p className="mt-1 text-xs text-foreground/80"><span className="mono text-[color:var(--sienna)]">NEXT —</span> {c.nextAction}</p>
                        )}
                        {c.transcript && (
                          <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{c.transcript}</pre>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              )}
      <AddLeadSheet mode="edit" lead={lead} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function LeadHero({ lead, onStartCall, onEdit }: { lead: Lead; onStartCall?: (lead: Lead) => void; onEdit?: () => void }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mono text-muted-foreground">— Contact</div>
        <h2 className="font-display text-4xl sm:text-5xl text-foreground leading-none mt-2 break-words">
          {lead.business}
        </h2>
        <div className="mono text-muted-foreground mt-3">
          {lead.city.toUpperCase()}, {lead.state.toUpperCase()}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <StatusBadge s={lead.status} />
          {lead.zoomBooked && (
            <span className="mono border border-[color:var(--sienna)] text-[color:var(--sienna)] px-1.5 py-1">
              ZOOM {lead.zoomDate ? formatDate(lead.zoomDate).toUpperCase() : "BOOKED"}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="mono text-muted-foreground mb-2">— Opportunity</div>
        <div className="mono text-foreground">{opportunityShort(lead.websiteOpportunity).toUpperCase()}</div>
        <p className="text-sm text-foreground/85 leading-relaxed mt-2">{pitchAngle(lead)}</p>
      </div>

      <a
        href={`tel:${lead.phone}`}
        className="flex items-center justify-center gap-3 w-full border border-foreground bg-foreground text-background py-4 px-5 hover:opacity-95 transition-opacity"
      >
        <PhoneCall className="h-4 w-4" />
        <span className="font-mono text-lg sm:text-xl tracking-wide">{lead.phone}</span>
      </a>

      <div className="flex items-center gap-5">
        {onStartCall && (
          <button onClick={() => onStartCall(lead)} className="mono ink-link">
            [ CALL ASSISTANT ]
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} className="mono ink-link">
            [ EDIT ]
          </button>
        )}
      </div>
      {/* silence unused initials import */}
      <span className="hidden">{initials(lead.business)}</span>
    </div>
  );
}

type OutcomeKey = "called" | "voicemail" | "callback" | "zoom" | "notInterested" | "sold";

function OutcomeActions({
  lead,
  setStatus,
  updateLead,
}: {
  lead: Lead;
  setStatus: (id: string, s: LeadStatus) => void;
  updateLead: (id: string, patch: Partial<Lead>) => void;
}) {
  const [pickerFor, setPickerFor] = useState<"callback" | "zoom" | null>(null);
  const defaultDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (pickerFor === "zoom" ? 5 : 2));
    return d.toISOString().slice(0, 10);
  })();
  const [pickedDate, setPickedDate] = useState<string>(defaultDate);

  useEffect(() => {
    if (pickerFor) {
      const d = new Date();
      d.setDate(d.getDate() + (pickerFor === "zoom" ? 5 : 2));
      setPickedDate(d.toISOString().slice(0, 10));
    }
  }, [pickerFor]);

  const apply = (key: OutcomeKey, isoFollowUp?: string | null) => {
    switch (key) {
      case "called":
        setStatus(lead.id, "Called");
        updateLead(lead.id, { nextFollowUp: addDaysISO(3) });
        break;
      case "voicemail":
        setStatus(lead.id, "Voicemail");
        updateLead(lead.id, { nextFollowUp: addDaysISO(2) });
        break;
      case "callback":
        setStatus(lead.id, "Callback Scheduled");
        updateLead(lead.id, { nextFollowUp: isoFollowUp ?? undefined });
        break;
      case "zoom":
        setStatus(lead.id, "Zoom Booked");
        updateLead(lead.id, {
          nextFollowUp: isoFollowUp ?? undefined,
          zoomBooked: true,
          zoomDate: isoFollowUp ?? undefined,
        });
        break;
      case "notInterested":
        setStatus(lead.id, "Not Interested");
        updateLead(lead.id, { nextFollowUp: undefined });
        break;
      case "sold":
        setStatus(lead.id, "Sold");
        updateLead(lead.id, { nextFollowUp: undefined });
        break;
    }
  };

  const confirmPicker = () => {
    if (!pickerFor || !pickedDate) return;
    const iso = new Date(`${pickedDate}T12:00:00`).toISOString();
    apply(pickerFor === "callback" ? "callback" : "zoom", iso);
    setPickerFor(null);
  };

  const buttons: { key: OutcomeKey; label: string; icon: typeof PhoneCall; primary?: boolean; onClick: () => void }[] = [
    { key: "called", label: "Called", icon: PhoneCall, primary: true, onClick: () => apply("called") },
    { key: "voicemail", label: "Voicemail", icon: Voicemail, onClick: () => apply("voicemail") },
    { key: "callback", label: "Callback", icon: CalendarClock, onClick: () => setPickerFor("callback") },
    { key: "zoom", label: "Zoom booked", icon: Video, onClick: () => setPickerFor("zoom") },
    { key: "notInterested", label: "Not interested", icon: XCircle, onClick: () => apply("notInterested") },
    { key: "sold", label: "Sold", icon: CheckCircle2, onClick: () => apply("sold") },
  ];

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="mono text-muted-foreground">— Log Outcome</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {buttons.map((b) => (
          <button
            key={b.key}
            onClick={b.onClick}
            className={`mono inline-flex items-center justify-center gap-1.5 px-3 py-3 border transition-colors ${
              b.primary
                ? "bg-foreground text-background border-foreground hover:opacity-90"
                : "border-border hover:border-foreground text-foreground"
            }`}
          >
            <b.icon className="h-3.5 w-3.5" />
            {b.label}
          </button>
        ))}
      </div>
      {pickerFor && (
        <div className="mt-2 border border-foreground bg-card p-3 space-y-2">
          <div className="mono text-muted-foreground">
            Pick {pickerFor === "zoom" ? "Zoom" : "callback"} date
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value)}
              className="flex-1 px-3 py-2 border border-border bg-transparent text-sm"
            />
            <button onClick={confirmPicker} className="mono px-4 py-2 bg-foreground text-background hover:opacity-90">
              [ CONFIRM ]
            </button>
            <button onClick={() => setPickerFor(null)} className="mono px-4 py-2 border border-border hover:border-foreground">
              [ CANCEL ]
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotesBlock({
  lead,
  note,
  setNote,
  addNote,
}: {
  lead: Lead;
  note: string;
  setNote: (v: string) => void;
  addNote: (id: string, note: string) => void;
}) {
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="mono text-muted-foreground">— Notes</div>
      {lead.notes && (
        <div className="border border-border p-3 text-sm whitespace-pre-wrap bg-card">
          {lead.notes}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note about this call…"
        rows={3}
        className="w-full px-3 py-2 border border-border bg-transparent text-sm resize-none focus:outline-none focus:border-foreground"
      />
      <div className="flex items-center justify-between gap-3">
        <div className="mono text-muted-foreground">
          Last contact — {lead.lastContacted ? formatDate(lead.lastContacted) : "never"}
        </div>
        <button
          onClick={() => { if (note.trim()) { addNote(lead.id, note.trim()); setNote(""); } }}
          disabled={!note.trim()}
          className="mono px-4 py-2 bg-foreground text-background hover:opacity-90 disabled:opacity-40"
        >
          [ SAVE NOTE ]
        </button>
      </div>
    </div>
  );
}

function TagsBlock({
  lead,
  updateLead,
}: {
  lead: Lead;
  updateLead: (id: string, patch: Partial<Lead>) => void;
}) {
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const t = normalizeTag(draft);
    if (!t || lead.tags.includes(t)) {
      setDraft("");
      return;
    }
    updateLead(lead.id, { tags: [...lead.tags, t] });
    setDraft("");
  };

  const removeTag = (t: string) => {
    updateLead(lead.id, { tags: lead.tags.filter((x) => x !== t) });
  };

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="mono text-muted-foreground">— Tags</div>
      <div className="flex flex-wrap gap-1.5">
        {lead.tags.length === 0 && (
          <span className="mono text-muted-foreground">— no tags yet —</span>
        )}
        {lead.tags.map((t) => (
          <TagBadge key={t} label={t} onRemove={() => removeTag(t)} />
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder="e.g. no website, referral"
          className="flex-1 px-3 py-2 border border-border bg-transparent text-sm focus:outline-none focus:border-foreground"
        />
        <button onClick={addTag} className="mono px-4 py-2 border border-foreground hover:bg-foreground hover:text-background">
          [ ADD ]
        </button>
      </div>
    </div>
  );
}

// ── Dossier ────────────────────────────────────────────────────────────────

const PROFILE_LABEL: Record<LeadProfileType, string> = {
  "website": "WEBSITE",
  "google-business": "GOOGLE BUSINESS",
  "facebook": "FACEBOOK",
  "instagram": "INSTAGRAM",
  "yelp": "YELP",
  "linkedin": "LINKEDIN",
  "directory": "DIRECTORY",
  "other": "OTHER",
};

const PROFILE_ORDER: LeadProfileType[] = [
  "website", "google-business", "facebook", "instagram", "yelp", "linkedin", "directory", "other",
];

function websiteStatusLine(status: LeadEnrichment["websiteStatus"]): { label: string; tone: "warn" | "ok" | "muted" } {
  switch (status) {
    case "none": return { label: "NO DEDICATED WEBSITE", tone: "warn" };
    case "outdated": return { label: "OUTDATED WEBSITE", tone: "warn" };
    case "good": return { label: "HAS WEBSITE", tone: "ok" };
    default: return { label: "WEBSITE STATUS UNKNOWN", tone: "muted" };
  }
}

function DossierRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 border-b border-border last:border-b-0">
      <div className="mono text-muted-foreground">{label}</div>
      <div className={`text-sm ${value ? "text-foreground" : "text-muted-foreground italic"}`}>
        {value || "— not found —"}
      </div>
    </div>
  );
}

function Dossier({ lead, updateLead }: { lead: Lead; updateLead: (id: string, patch: Partial<Lead>) => void }) {
  const [researching, setResearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const e = lead.enrichment;

  const research = async () => {
    setResearching(true);
    setErr(null);
    try {
      const res = await fetch("/api/enrich-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      // Server already persisted; mirror the same patch into the local store.
      const u = data.updates as {
        enrichment?: LeadEnrichment;
        confidenceScore?: number;
        confidenceEvidence?: string[];
        unverified?: boolean;
        unverifiedReason?: string | null;
      };
      updateLead(lead.id, {
        enrichment: u.enrichment,
        confidenceScore: u.confidenceScore,
        confidenceEvidence: u.confidenceEvidence,
        unverified: u.unverified,
        unverifiedReason: u.unverifiedReason ?? undefined,
      });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Research failed");
    } finally {
      setResearching(false);
    }
  };

  // ── Un-enriched state ──
  if (!e) {
    return (
      <div className="border-t border-border pt-4">
        <div className="mono text-muted-foreground mb-3">— Dossier</div>
        <div className="border border-dashed border-border p-5 text-center space-y-3">
          <div className="mono text-muted-foreground">— not yet researched —</div>
          <div className="text-xs text-muted-foreground max-w-sm mx-auto">
            This lead has no enrichment data. Run research to fetch the online-presence map,
            reviews snapshot, and a tailored pitch angle.
          </div>
          <button
            onClick={research}
            disabled={researching}
            className="mono inline-flex items-center gap-2 px-4 py-2 bg-foreground text-background hover:opacity-90 disabled:opacity-60"
          >
            {researching
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> RESEARCHING…</>
              : <><Sparkles className="h-3.5 w-3.5" /> [ RESEARCH NOW ]</>}
          </button>
          {err && <div className="mono text-[color:var(--sienna)]">{err}</div>}
        </div>
      </div>
    );
  }

  // ── Enriched dossier ──
  const status = websiteStatusLine(e.websiteStatus);
  const sortedProfiles = [...e.profiles].sort(
    (a, b) => PROFILE_ORDER.indexOf(a.type) - PROFILE_ORDER.indexOf(b.type),
  );
  const conf = lead.confidenceScore;
  const evidence = lead.confidenceEvidence ?? [];

  return (
    <div className="border-t border-border pt-4 space-y-6">
      {/* Section head + re-research */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="mono text-muted-foreground">— Dossier</div>
        <div className="flex items-center gap-3">
          {e.enrichedAt && (
            <span className="mono text-muted-foreground text-xs">
              RESEARCHED {formatDate(e.enrichedAt).toUpperCase()}
            </span>
          )}
          <button
            onClick={research}
            disabled={researching}
            className="mono ink-link"
            title="Re-run research"
          >
            {researching ? "RESEARCHING…" : "[ REFRESH ]"}
          </button>
        </div>
      </div>

      {/* 1. Summary + Confidence */}
      <div className="space-y-3">
        {e.verifiedSummary ? (
          <p className="text-sm text-foreground/90 leading-relaxed">{e.verifiedSummary}</p>
        ) : (
          <p className="mono text-muted-foreground italic">— no verified summary available —</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {typeof conf === "number" && (
            <span className="mono border border-foreground px-1.5 py-1 text-foreground">
              CONF {String(conf).padStart(2, "0")}
            </span>
          )}
          {evidence.map((chip, i) => (
            <span key={i} className="mono border border-border px-1.5 py-1 text-muted-foreground">
              {chip}
            </span>
          ))}
        </div>
        {lead.unverified && (
          <div className="mono text-[color:var(--sienna)] border border-[color:var(--sienna)] px-3 py-2">
            ⚠ UNVERIFIED — {(lead.unverifiedReason || "review before calling").toUpperCase()}
          </div>
        )}
      </div>

      {/* 2. Online-presence map */}
      <div>
        <div className="mono text-muted-foreground mb-2">— Online Presence</div>
        <div className={`mono mb-3 ${
          status.tone === "warn" ? "text-[color:var(--sienna)]"
          : status.tone === "ok" ? "text-foreground"
          : "text-muted-foreground"
        }`}>
          {status.label}
        </div>
        {sortedProfiles.length === 0 ? (
          <div className="mono text-muted-foreground italic">— no profiles discovered —</div>
        ) : (
          <ul className="border-t border-border">
            {sortedProfiles.map((p, i) => (
              <li key={`${p.type}-${i}`} className="border-b border-border">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 px-1 py-2.5 hover:bg-foreground/[0.04]"
                >
                  <span className="mono text-muted-foreground">{PROFILE_LABEL[p.type]}</span>
                  <span className="text-sm text-foreground truncate">
                    {p.label || p.url}
                  </span>
                  <span className="mono text-muted-foreground inline-flex items-center gap-1">
                    OPEN <ExternalLink className="h-3 w-3" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 3. Reviews / Hours / Owner / Recent Activity */}
      <div>
        <div className="mono text-muted-foreground mb-2">— Signals</div>
        <div className="border-t border-border">
          <DossierRow
            label="REVIEWS"
            value={
              e.reviews.length
                ? e.reviews.map((r) => {
                    const bits = [r.rating ? `${r.rating}★` : null, r.count ? `${r.count} reviews` : null].filter(Boolean).join(" · ");
                    return `${r.source} — ${bits || "found"}`;
                  }).join("  ·  ")
                : null
            }
          />
          <DossierRow label="HOURS" value={e.hours} />
          <DossierRow label="OWNER" value={e.ownerName} />
          <DossierRow label="RECENT ACTIVITY" value={e.recentActivity} />
        </div>
      </div>

      {/* 4. Pitch angle */}
      <div>
        <div className="mono text-muted-foreground mb-2">— Pitch Angle</div>
        {lead.unverified ? (
          <p className="mono text-[color:var(--sienna)] leading-relaxed">
            {e.pitchAngle || `⚠ Poor prospect — ${(lead.unverifiedReason || "unverified").toLowerCase()}. Skip or verify basics before spending call time.`}
          </p>
        ) : e.pitchAngle ? (
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{e.pitchAngle}</p>
        ) : (
          <p className="text-sm text-foreground/85 leading-relaxed">{pitchAngle(lead)}</p>
        )}
      </div>

      {err && <div className="mono text-[color:var(--sienna)]">{err}</div>}
    </div>
  );
}
