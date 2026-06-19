import { Eye, Pencil, ChevronDown, Mic, ArrowUp, ArrowDown } from "lucide-react";
import type { Lead, LeadStatus, Quality } from "@/lib/types";
import { QualityBadge, StatusBadge } from "./Badges";
import { formatDate, isValidContactDate, relativeFollowUp, STATUSES } from "@/lib/crm-utils";
import { useMemo, useState } from "react";

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

type SortKey = "priority" | "business" | "city" | "quality" | "status" | "lastContacted" | "nextFollowUp";
type SortDir = "asc" | "desc";

const qualityRank: Record<Quality, number> = { High: 3, Medium: 2, Low: 1 };
const statusRank: Record<LeadStatus, number> = {
  "Not Called": 0,
  Called: 1,
  Voicemail: 2,
  "Callback Scheduled": 3,
  "Zoom Booked": 4,
  Sold: 5,
  "Not Interested": 6,
};

function sortLeads(leads: Lead[], key: SortKey, dir: SortDir): Lead[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "priority":
        cmp = a.priority - b.priority;
        break;
      case "business":
        cmp = a.business.localeCompare(b.business);
        break;
      case "city":
        cmp = a.city.localeCompare(b.city);
        break;
      case "quality":
        cmp = qualityRank[a.quality] - qualityRank[b.quality];
        break;
      case "status":
        cmp = statusRank[a.status] - statusRank[b.status];
        break;
      case "lastContacted": {
        const ad = isValidContactDate(a.lastContacted) ? new Date(a.lastContacted!).getTime() : 0;
        const bd = isValidContactDate(b.lastContacted) ? new Date(b.lastContacted!).getTime() : 0;
        cmp = ad - bd;
        break;
      }
      case "nextFollowUp": {
        const ad = isValidContactDate(a.nextFollowUp) ? new Date(a.nextFollowUp!).getTime() : 0;
        const bd = isValidContactDate(b.nextFollowUp) ? new Date(b.nextFollowUp!).getTime() : 0;
        cmp = ad - bd;
        break;
      }
    }
    if (cmp !== 0) return cmp * mult;

    // Stable secondary ordering: best quality first, untouched statuses first, then priority.
    if (key !== "quality") {
      const qcmp = qualityRank[b.quality] - qualityRank[a.quality];
      if (qcmp !== 0) return qcmp;
    }
    if (key !== "status") {
      const scmp = statusRank[a.status] - statusRank[b.status];
      if (scmp !== 0) return scmp;
    }
    return a.priority - b.priority;
  });
}

const sortableHeaders: { key: SortKey; label: string }[] = [
  { key: "priority", label: "#" },
  { key: "business", label: "Business" },
  { key: "city", label: "City" },
  { key: "quality", label: "Quality" },
  { key: "status", label: "Status" },
  { key: "lastContacted", label: "Last" },
  { key: "nextFollowUp", label: "Follow-up" },
];

export function LeadTable({ leads, selected, toggleSelect, toggleAll, onView, onStatusChange, onCall }: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "quality", dir: "desc" });
  const allChecked = leads.length > 0 && leads.every((l) => selected.has(l.id));

  const sorted = useMemo(() => sortLeads(leads, sort.key, sort.dir), [leads, sort.key, sort.dir]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));
  };

  const SortIcon = sort.dir === "asc" ? ArrowUp : ArrowDown;

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
              {sortableHeaders.map(({ key, label }) => (
                <th key={key} className="py-3 px-2">
                  <button
                    onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {label}
                    {sort.key === key && <SortIcon className="h-3 w-3" />}
                  </button>
                </th>
              ))}
              <th className="py-3 px-2">Online Presence</th>
              <th className="py-3 px-2">Opportunity</th>
              <th className="py-3 px-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l, idx) => (
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
                <td className="py-3 px-2 max-w-[260px]">
                  <span className="text-xs text-muted-foreground line-clamp-2">{l.onlinePresence}</span>
                </td>
                <td className="py-3 px-2">
                  <span className="text-[11px] text-foreground/80">{l.websiteOpportunity}</span>
                </td>
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
            {sorted.length === 0 && (
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
