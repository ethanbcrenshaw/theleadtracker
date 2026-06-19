import { X, MapPin, Calendar, Sparkles, ExternalLink, User, Mic, Video, ArrowLeft, PhoneCall, Voicemail, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Lead, LeadStatus, WebsiteOpportunity } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { StatusBadge } from "./Badges";
import { formatDate, pitchAngle, sourceLinks, qualityFromOpportunity } from "@/lib/crm-utils";

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

function opportunityTagColors(op: WebsiteOpportunity): { bg: string; text: string } {
  const q = qualityFromOpportunity(op);
  if (q === "High") return { bg: "#FAECE7", text: "#712B13" };
  if (q === "Medium") return { bg: "#FAEEDA", text: "#633806" };
  return { bg: "#F1EFE8", text: "#2C2C2A" };
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
        <div className="h-full grid place-items-center text-sm text-muted-foreground italic p-8 text-center">
          Select a lead from the list to see details.
        </div>
      );
    }
    return (
      <div className="h-full overflow-y-auto">
        <div className="sticky top-0 bg-background/90 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            {backLabel && (
              <button
                onClick={onClose}
                className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-secondary text-sm text-foreground"
              >
                <ArrowLeft className="h-4 w-4" /> {backLabel}
              </button>
            )}
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Lead #{lead.priority}
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
            className="fixed inset-0 bg-foreground/30 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[560px] bg-background border-l border-border z-50 overflow-y-auto"
          >
            <div className="sticky top-0 bg-background/90 backdrop-blur border-b border-border px-6 py-4 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Lead #{lead.priority}</span>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
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
  return (
    <div className="p-6 space-y-6">
              <LeadHero
                lead={lead}
                onStartCall={onStartCall}
              />
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

              {(lead.aiSummary || lead.aiNextAction) && (
                <div className="rounded-2xl bg-gradient-to-br from-navy/[0.05] to-maroon/[0.05] border border-navy/15 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-navy text-navy-foreground text-[10px] font-semibold uppercase tracking-wider">
                      <Sparkles className="h-2.5 w-2.5" /> AI Notes
                    </span>
                    <span className="text-[11px] text-muted-foreground">latest call summary</span>
                  </div>
                  {lead.aiSummary && <p className="text-sm text-foreground/90 leading-relaxed">{lead.aiSummary}</p>}
                  {lead.aiNextAction && (
                    <div className="mt-2 text-xs text-foreground/80">
                      <span className="font-semibold text-maroon">Next:</span> {lead.aiNextAction}
                    </div>
                  )}
                </div>
              )}

              {lead.owner && (
                <div className="rounded-xl bg-gradient-to-br from-maroon/[0.06] to-navy/[0.04] border border-maroon/20 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-maroon mb-2">
                    <User className="h-3.5 w-3.5" /> Owner
                  </div>
                  <div className="font-display text-xl text-navy">{lead.owner}</div>
                  {lead.ownerSource && (
                    <a
                      href={lead.ownerSource.split(/[ ,&]+http/)[0].startsWith("http") ? lead.ownerSource.split(/\s|,/)[0] : "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-navy"
                    >
                      <ExternalLink className="h-3 w-3" /> source
                    </a>
                  )}
                </div>
              )}

              <div className="rounded-xl bg-card border border-border p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Online Presence</div>
                <p className="text-sm text-foreground/90">{lead.onlinePresence}</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {lead.sources.map((s) => (
                    <span key={s} className="px-2 py-0.5 rounded-full bg-secondary border border-border text-[11px]">{s}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                  <ExternalLink className="h-3.5 w-3.5" /> Find Them Online
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {sourceLinks(lead).map((link) => (
                    <a
                      key={link.source + link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between gap-2 rounded-xl bg-card border border-border px-3 py-2.5 hover:border-navy/40 hover:bg-tan/10 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{link.label}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{link.domain}</div>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-navy shrink-0" />
                    </a>
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground italic mt-2">
                  Links search by business name + city — opens the most likely profile.
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manual Follow-Up Override</div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-secondary border border-border text-sm"
                  />
                  <button
                    onClick={() => updateLead(lead.id, { nextFollowUp: followUp ? new Date(followUp).toISOString() : undefined })}
                    className="px-3 py-2 rounded-xl bg-navy text-navy-foreground text-xs font-medium hover:opacity-90"
                  >
                    Save
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" /> Contact History
                </div>
                {lead.history.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic">No contact yet — start with a call.</div>
                ) : (
                  <div className="space-y-2">
                    {[...lead.history].reverse().map((h) => (
                      <div key={h.id} className="rounded-xl bg-card border border-border p-3">
                        <div className="flex items-center justify-between">
                          <StatusBadge s={h.status} />
                          <span className="text-xs text-muted-foreground">{formatDate(h.date)}</span>
                        </div>
                        {h.note && <p className="text-xs text-foreground/80 mt-1">{h.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {lead.callRecords && lead.callRecords.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                    <Mic className="h-3.5 w-3.5" /> Call Recordings & Summaries
                  </div>
                  <div className="space-y-2">
                    {[...lead.callRecords].reverse().map((c) => (
                      <details key={c.id} className="rounded-xl bg-card border border-border p-3">
                        <summary className="cursor-pointer flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">{c.outcome}</span>
                          <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                        </summary>
                        {c.summary && <p className="mt-2 text-sm text-foreground/90">{c.summary}</p>}
                        {c.nextAction && (
                          <p className="mt-1 text-xs text-foreground/80"><span className="font-semibold text-maroon">Next:</span> {c.nextAction}</p>
                        )}
                        {c.transcript && (
                          <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{c.transcript}</pre>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              )}
    </div>
  );
}

function LeadHero({ lead, onStartCall }: { lead: Lead; onStartCall?: (lead: Lead) => void }) {
  const tag = opportunityTagColors(lead.websiteOpportunity);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div
          className="h-12 w-12 shrink-0 rounded-full grid place-items-center font-display text-lg font-semibold"
          style={{ backgroundColor: tag.bg, color: tag.text }}
        >
          {initials(lead.business)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl sm:text-3xl font-medium text-foreground leading-tight truncate">{lead.business}</h2>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{lead.city}, {lead.state}</span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <StatusBadge s={lead.status} />
          {lead.zoomBooked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-maroon text-maroon-foreground text-[10px] font-medium">
              <Video className="h-3 w-3" /> Zoom {lead.zoomDate ? formatDate(lead.zoomDate) : "booked"}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
          style={{ backgroundColor: tag.bg, color: tag.text }}
        >
          {opportunityShort(lead.websiteOpportunity)}
        </span>
        <p className="text-sm text-foreground/85 leading-relaxed">{pitchAngle(lead)}</p>
      </div>

      <a
        href={`tel:${lead.phone}`}
        className="flex items-center justify-center gap-3 w-full rounded-2xl bg-maroon text-maroon-foreground py-4 px-5 shadow-soft hover:opacity-95 active:opacity-90 transition-opacity"
      >
        <PhoneCall className="h-5 w-5" />
        <span className="font-mono text-lg sm:text-xl font-medium tracking-wide">{lead.phone}</span>
      </a>

      {onStartCall && (
        <button
          onClick={() => onStartCall(lead)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-navy text-navy-foreground text-xs font-medium hover:opacity-90"
        >
          <Mic className="h-3.5 w-3.5" /> Start Call Assistant
        </button>
      )}
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

  const buttons: { key: OutcomeKey; label: string; icon: typeof PhoneCall; classes: string; onClick: () => void }[] = [
    { key: "called", label: "Called", icon: PhoneCall, classes: "bg-navy text-navy-foreground", onClick: () => apply("called") },
    { key: "voicemail", label: "Voicemail", icon: Voicemail, classes: "bg-[oklch(0.78_0.05_300)] text-[oklch(0.25_0.08_300)]", onClick: () => apply("voicemail") },
    { key: "callback", label: "Callback", icon: CalendarClock, classes: "bg-gold text-gold-foreground", onClick: () => setPickerFor("callback") },
    { key: "zoom", label: "Zoom booked", icon: Video, classes: "bg-sage text-sage-foreground", onClick: () => setPickerFor("zoom") },
    { key: "notInterested", label: "Not interested", icon: XCircle, classes: "bg-clay/20 text-clay", onClick: () => apply("notInterested") },
    { key: "sold", label: "Sold", icon: CheckCircle2, classes: "bg-[oklch(0.52_0.12_150)] text-white", onClick: () => apply("sold") },
  ];

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Log Outcome</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {buttons.map((b) => (
          <button
            key={b.key}
            onClick={b.onClick}
            className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition-opacity ${b.classes}`}
          >
            <b.icon className="h-4 w-4" />
            {b.label}
          </button>
        ))}
      </div>
      {pickerFor && (
        <div className="mt-2 rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="text-xs font-medium text-foreground">
            Pick {pickerFor === "zoom" ? "Zoom" : "callback"} date
          </div>
          <div className="flex gap-2">
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-sm pointer-events-auto"
            />
            <button
              onClick={confirmPicker}
              className="px-3 py-2 rounded-lg bg-navy text-navy-foreground text-xs font-medium hover:opacity-90"
            >
              Confirm
            </button>
            <button
              onClick={() => setPickerFor(null)}
              className="px-3 py-2 rounded-lg bg-secondary border border-border text-xs hover:bg-tan/15"
            >
              Cancel
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
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notes</div>
      {lead.notes && (
        <div className="rounded-xl bg-secondary border border-border p-3 text-sm whitespace-pre-wrap">
          {lead.notes}
        </div>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note about this call…"
        rows={3}
        className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm resize-none"
      />
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-muted-foreground">
          Last contact: <span className="text-foreground">{lead.lastContacted ? formatDate(lead.lastContacted) : "never"}</span>
        </div>
        <button
          onClick={() => { if (note.trim()) { addNote(lead.id, note.trim()); setNote(""); } }}
          disabled={!note.trim()}
          className="px-3 py-1.5 rounded-lg bg-navy text-navy-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40"
        >
          Save note
        </button>
      </div>
    </div>
  );
}
