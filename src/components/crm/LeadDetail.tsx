import { X, Phone, MapPin, Calendar, Sparkles, Plus, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Lead, LeadStatus } from "@/lib/types";
import { useLeads } from "@/lib/store";
import { QualityBadge, StatusBadge } from "./Badges";
import { formatDate, pitchAngle, sourceLinks } from "@/lib/crm-utils";

interface Props {
  lead: Lead | null;
  onClose: () => void;
}

const QUICK_ACTIONS: { label: string; status: LeadStatus; tone: string }[] = [
  { label: "Mark Called", status: "Called", tone: "bg-navy text-navy-foreground" },
  { label: "Mark Voicemail", status: "Voicemail", tone: "bg-[oklch(0.75_0.05_300)] text-[oklch(0.25_0.05_300)]" },
  { label: "Schedule Callback", status: "Callback Scheduled", tone: "bg-gold text-gold-foreground" },
  { label: "Book Zoom", status: "Zoom Booked", tone: "bg-sage text-sage-foreground" },
  { label: "Mark Sold", status: "Sold", tone: "bg-[oklch(0.5_0.1_150)] text-white" },
  { label: "Not Interested", status: "Not Interested", tone: "bg-clay/20 text-clay" },
];

export function LeadDetail({ lead, onClose }: Props) {
  const setStatus = useLeads((s) => s.setStatus);
  const addNote = useLeads((s) => s.addNote);
  const updateLead = useLeads((s) => s.updateLead);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");

  useEffect(() => {
    setNote("");
    setFollowUp(lead?.nextFollowUp ? lead.nextFollowUp.slice(0, 10) : "");
  }, [lead?.id]);

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

            <div className="p-6 space-y-6">
              <div>
                <h2 className="font-display text-3xl font-medium text-foreground">{lead.business}</h2>
                {lead.ownerNote && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-tan/30 text-tan-foreground text-[11px] font-medium">
                    {lead.ownerNote}
                  </span>
                )}
                <div className="flex items-center gap-3 mt-3">
                  <QualityBadge q={lead.quality} />
                  <StatusBadge s={lead.status} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <a href={`tel:${lead.phone}`} className="rounded-xl bg-secondary border border-border p-3 hover:bg-tan/15 transition-colors">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5" />Phone</div>
                  <div className="font-mono text-sm text-navy mt-1">{lead.phone}</div>
                </a>
                <div className="rounded-xl bg-secondary border border-border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />Location</div>
                  <div className="text-sm mt-1">{lead.city}, {lead.state}</div>
                </div>
              </div>

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

              <div className="rounded-xl bg-gradient-to-br from-tan/20 to-gold/15 border border-tan/40 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-tan-foreground mb-2">
                  <Sparkles className="h-3.5 w-3.5" /> Website Pitch Angle
                </div>
                <p className="text-sm text-foreground/90 leading-relaxed">{pitchAngle(lead)}</p>
                <div className="mt-2 text-[11px] text-muted-foreground italic">
                  Opportunity: {lead.websiteOpportunity}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Quick Actions</div>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.status}
                      onClick={() => setStatus(lead.id, a.status)}
                      className={`px-3 py-2 rounded-xl text-xs font-medium ${a.tone} hover:opacity-90 transition-opacity`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next Follow-Up</div>
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
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Notes</div>
                {lead.notes && (
                  <div className="rounded-xl bg-secondary border border-border p-3 text-sm whitespace-pre-wrap mb-2">
                    {lead.notes}
                  </div>
                )}
                <div className="flex gap-2">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note…"
                    rows={2}
                    className="flex-1 px-3 py-2 rounded-xl bg-card border border-border text-sm resize-none"
                  />
                  <button
                    onClick={() => { if (note.trim()) { addNote(lead.id, note); setNote(""); } }}
                    className="px-3 rounded-xl bg-navy text-navy-foreground hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" />
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
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
