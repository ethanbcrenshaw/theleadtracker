import { ChevronDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Lead, LeadStatus, Quality } from "@/lib/types";
import { QualityBadge, StatusBadge, TagBadge, TierChip, EvidenceChip } from "./Badges";
import { Botanical } from "./Botanical";
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
  const cls = r.tone === "overdue" ? "text-[color:var(--sienna)]" : "text-foreground";
  return <span className={`mono ${cls}`}>{r.label}</span>;
}

type SortKey = "priority" | "business" | "city" | "quality" | "status" | "lastContacted" | "nextFollowUp";
type SortDir = "asc" | "desc";

export const qualityRank: Record<Quality, number> = { High: 3, Medium: 2, Low: 1 };
export const statusRank: Record<LeadStatus, number> = {
  "Not Called": 0,
  Called: 1,
  Voicemail: 2,
  "Callback Scheduled": 3,
  "Zoom Booked": 4,
  Sold: 5,
  "Not Interested": 6,
};

export type LeadSortKey = SortKey;
export type LeadSortDir = SortDir;

export function sortLeads(leads: Lead[], key: SortKey, dir: SortDir): Lead[] {
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

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      onClick={() => onClick(sortKey)}
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {active === sortKey && <Icon className="h-3 w-3" />}
    </button>
  );
}

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

  return (
    <div className="border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-left mono text-muted-foreground border-b-2 border-foreground/60">
              <th className="pl-5 py-3 w-8">
                <input type="checkbox" checked={allChecked} onChange={toggleAll}
                  className="rounded-none border-border accent-foreground" />
              </th>
              <th className="py-3 px-2">
                <SortHeader label="#" sortKey="priority" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2">
                <SortHeader label="Business" sortKey="business" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2">
                <SortHeader label="City" sortKey="city" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2">Phone</th>
              <th className="py-3 px-2">Presence</th>
              <th className="py-3 px-2">Opportunity</th>
              <th className="py-3 px-2">
                <SortHeader label="Quality" sortKey="quality" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2">
                <SortHeader label="Status" sortKey="status" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2">
                <SortHeader label="Last" sortKey="lastContacted" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2">
                <SortHeader label="Follow-up" sortKey="nextFollowUp" active={sort.key} dir={sort.dir} onClick={toggleSort} />
              </th>
              <th className="py-3 px-2 pr-5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l, idx) => (
              <tr
                key={l.id}
                className={`border-t border-border hover:bg-foreground/[0.03] transition-colors ${
                  selected.has(l.id) ? "bg-foreground/[0.04]" : ""
                }`}
              >
                <td className="pl-5 py-4">
                  <input type="checkbox" checked={selected.has(l.id)}
                    onChange={() => toggleSelect(l.id)}
                    className="rounded-none border-border accent-foreground" />
                </td>
                <td className="py-4 px-2 mono text-muted-foreground">{String(idx + 1).padStart(3, "0")}</td>
                <td className="py-4 px-2">
                  <button onClick={() => onView(l)} className="font-display text-lg text-foreground hover:underline underline-offset-4 text-left leading-tight">
                    {l.business}
                  </button>
                  {l.owner && (
                    <div className="mono text-muted-foreground mt-1">
                      {l.owner}
                    </div>
                  )}
                  {l.ownerNote && (
                    <div className="text-xs text-muted-foreground mt-0.5 italic">{l.ownerNote}</div>
                  )}
                  {l.verificationTier && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <TierChip tier={l.verificationTier} />
                      {l.unverified && (
                        <span className="mono text-[color:var(--sienna)]">
                          ⚠ {(l.unverifiedReason || "review").toUpperCase()}
                        </span>
                      )}
                    </div>
                  )}
                  {(l.confidenceEvidence?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {typeof l.confidenceScore === "number" && (
                        <span className="figure-box mono text-foreground py-0.5">
                          <span>CONF</span>
                          <span className="font-display text-base leading-none">{String(l.confidenceScore).padStart(2, "0")}</span>
                        </span>
                      )}
                      {l.confidenceEvidence!.slice(0, 3).map((chip, i) => (
                        <EvidenceChip key={i} label={chip} />
                      ))}
                    </div>
                  )}
                  {l.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {l.tags.map((t) => <TagBadge key={t} label={t} />)}
                    </div>
                  )}
                </td>
                <td className="py-4 px-2 mono text-muted-foreground">{l.city}, {l.state}</td>
                <td className="py-4 px-2">
                  <a href={`tel:${l.phone}`} className="mono ink-link">{l.phone}</a>
                </td>
                <td className="py-4 px-2 max-w-[260px]">
                  <span className="text-xs text-muted-foreground line-clamp-2">{l.onlinePresence}</span>
                </td>
                <td className="py-4 px-2">
                  <span className="mono text-muted-foreground">{l.websiteOpportunity}</span>
                </td>
                <td className="py-4 px-2"><QualityBadge q={l.quality} /></td>
                <td className="py-4 px-2 relative">
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
                      <div className="absolute z-30 mt-1 right-0 bg-popover border border-foreground py-1 min-w-[200px]">
                        {STATUSES.map((s) => (
                          <button
                            key={s}
                            onClick={() => { onStatusChange(l.id, s); setOpenMenu(null); }}
                            className="mono w-full text-left px-3 py-2 hover:bg-foreground/[0.06]"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </td>
                <td className="py-4 px-2 mono text-muted-foreground whitespace-nowrap">
                  {isValidContactDate(l.lastContacted) ? formatDate(l.lastContacted) : "NEVER"}
                </td>
                <td className="py-4 px-2"><FollowUpPill iso={l.nextFollowUp} lastContacted={l.lastContacted} /></td>
                <td className="py-4 px-2 pr-5">
                  <div className="flex items-center gap-3 justify-end">
                    {onCall && (
                      <button onClick={() => onCall(l)} className="mono text-muted-foreground hover:text-foreground" title="Start Call Assistant">
                        [ CALL ]
                      </button>
                    )}
                    <button onClick={() => onView(l)} className="mono text-muted-foreground hover:text-foreground" title="View">
                      [ VIEW ]
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center py-16 mono text-muted-foreground">
                  <div className="flex flex-col items-center gap-5">
                    <Botanical variant="hip" className="h-24 w-20" opacity={0.75} />
                    <div>— no leads match these filters —</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
