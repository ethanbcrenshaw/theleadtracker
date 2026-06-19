import { Eye, Pencil, ChevronDown, Mic } from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/types";
import { QualityBadge, StatusBadge } from "./Badges";
import { formatDate, isValidContactDate, relativeFollowUp, STATUSES } from "@/lib/crm-utils";
import { useState } from "react";

interface Props {
  leads: Lead[];
  selected: Set<string>;
  toggleSelect: (id: string) => void;
  toggleAll: () => void;
  onView: (lead: Lead) => void;
  onStatusChange: (id: string, s: LeadStatus) => void;
  onCall?: (lead: Lead) => void;
}

function FollowUpPill({ iso, lastContacted }: { iso?: string; lastContacted?: string }) {
  const r = relativeFollowUp(iso, lastContacted);
  if (!r) return <span className="text-muted-foreground">—</span>;
  const tone =
    r.tone === "overdue" ? "bg-clay/15 text-clay" :
    r.tone === "today" ? "bg-gold/30 text-gold-foreground" :
    r.tone === "soon" ? "bg-tan/30 text-tan-foreground" :
    "bg-muted text-muted-foreground";
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${tone}`}>{r.label}</span>;
}

export function LeadTable({ leads, selected, toggleSelect, toggleAll, onView, onStatusChange, onCall }: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const allChecked = leads.length > 0 && leads.every((l) => selected.has(l.id));

  return (
    <div className="rounded-2xl bg-card border border-border shadow-soft overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-secondary/60 backdrop-blur-sm z-10">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="pl-4 py-3 w-8">
                <input type="checkbox" checked={allChecked} onChange={toggleAll}
                  className="rounded border-border accent-navy" />
              </th>
              <th className="py-3 px-2">#</th>
              <th className="py-3 px-2">Business</th>
              <th className="py-3 px-2">City</th>
              <th className="py-3 px-2">Phone</th>
              <th className="py-3 px-2">Online Presence</th>
              <th className="py-3 px-2">Opportunity</th>
              <th className="py-3 px-2">Quality</th>
              <th className="py-3 px-2">Status</th>
              <th className="py-3 px-2">Last</th>
              <th className="py-3 px-2">Follow-up</th>
              <th className="py-3 px-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l, idx) => (
              <tr
                key={l.id}
                className={`border-t border-border/60 hover:bg-secondary/40 transition-colors ${
                  idx % 2 === 1 ? "bg-secondary/20" : ""
                } ${selected.has(l.id) ? "bg-tan/10" : ""}`}
              >
                <td className="pl-4 py-3">
                  <input type="checkbox" checked={selected.has(l.id)}
                    onChange={() => toggleSelect(l.id)}
                    className="rounded border-border accent-navy" />
                </td>
                <td className="py-3 px-2 text-muted-foreground font-mono text-xs">{l.priority}</td>
                <td className="py-3 px-2">
                  <button onClick={() => onView(l)} className="font-medium text-foreground hover:text-navy text-left">
                    {l.business}
                  </button>
                  {l.owner && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      <span className="text-maroon">●</span> {l.owner}
                    </div>
                  )}
                  {l.ownerNote && (
                    <div className="text-[11px] text-tan-foreground/80 mt-0.5">{l.ownerNote}</div>
                  )}
                </td>
                <td className="py-3 px-2 text-muted-foreground">{l.city}, {l.state}</td>
                <td className="py-3 px-2">
                  <a href={`tel:${l.phone}`} className="text-navy hover:underline font-mono text-xs">{l.phone}</a>
                </td>
                <td className="py-3 px-2 max-w-[260px]">
                  <span className="text-xs text-muted-foreground line-clamp-2">{l.onlinePresence}</span>
                </td>
                <td className="py-3 px-2">
                  <span className="text-[11px] text-foreground/80">{l.websiteOpportunity}</span>
                </td>
                <td className="py-3 px-2"><QualityBadge q={l.quality} /></td>
                <td className="py-3 px-2 relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === l.id ? null : l.id)}
                    className="inline-flex items-center gap-1 group"
                  >
                    <StatusBadge s={l.status} />
                    <ChevronDown className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
                  </button>
                  {openMenu === l.id && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setOpenMenu(null)} />
                      <div className="absolute z-30 mt-1 right-0 bg-popover border border-border rounded-xl shadow-elev py-1 min-w-[180px]">
                        {STATUSES.map((s) => (
                          <button
                            key={s}
                            onClick={() => { onStatusChange(l.id, s); setOpenMenu(null); }}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </td>
                <td className="py-3 px-2 text-xs text-muted-foreground whitespace-nowrap">
                  {isValidContactDate(l.lastContacted) ? formatDate(l.lastContacted) : <span className="italic text-muted-foreground/70">Never</span>}
                </td>
                <td className="py-3 px-2"><FollowUpPill iso={l.nextFollowUp} lastContacted={l.lastContacted} /></td>
                <td className="py-3 px-2 pr-4">
                  <div className="flex items-center gap-1">
                    {onCall && (
                      <button onClick={() => onCall(l)}
                        className="p-1.5 rounded-lg hover:bg-maroon/10 text-maroon" title="Start Call Assistant">
                        <Mic className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => onView(l)} className="p-1.5 rounded-lg hover:bg-secondary" title="View">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button onClick={() => onView(l)} className="p-1.5 rounded-lg hover:bg-secondary" title="Edit">
                      <Pencil className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={12} className="text-center py-12 text-muted-foreground">
                No leads match these filters. Try clearing a chip.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
