import { useEffect, useMemo, useState } from "react";
import { Mic, Phone, ChevronRight } from "lucide-react";
import type { Lead } from "@/lib/types";
import { LeadDetail } from "./LeadDetail";
import { QualityBadge, StatusBadge } from "./Badges";
import { sortLeads } from "./LeadTable";
import { isValidContactDate, relativeFollowUp } from "@/lib/crm-utils";

interface Props {
  leads: Lead[];
  onStartCall?: (lead: Lead) => void;
}

export function QueueView({ leads, onStartCall }: Props) {
  const sorted = useMemo(() => sortLeads(leads, "priority", "asc"), [leads]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-select top lead on load / when list changes if current selection is gone.
  useEffect(() => {
    if (sorted.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !sorted.some((l) => l.id === activeId)) {
      setActiveId(sorted[0].id);
    }
  }, [sorted, activeId]);

  const active = sorted.find((l) => l.id === activeId) ?? null;

  const handlePick = (l: Lead) => {
    setActiveId(l.id);
    setMobileOpen(true);
  };

  return (
    <div className="rounded-2xl bg-card border border-border shadow-soft overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] min-h-[70vh]">
        {/* Left: list */}
        <div
          className={`border-border lg:border-r ${
            mobileOpen ? "hidden lg:block" : "block"
          }`}
        >
          <div className="px-4 py-3 border-b border-border bg-secondary/40 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Call Queue · {sorted.length}
          </div>
          <ul className="divide-y divide-border max-h-[75vh] overflow-y-auto">
            {sorted.map((l) => {
              const isActive = l.id === activeId;
              const fu = relativeFollowUp(l.nextFollowUp, l.lastContacted);
              return (
                <li key={l.id}>
                  <button
                    onClick={() => handlePick(l)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-tan/10 transition-colors ${
                      isActive ? "lg:bg-tan/15 lg:border-l-2 lg:border-maroon" : ""
                    }`}
                  >
                    <div className="shrink-0 mt-0.5 grid h-9 w-9 place-items-center rounded-xl bg-navy/[0.08] text-navy text-xs font-semibold">
                      #{l.priority}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium text-foreground">{l.business}</div>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {l.city}, {l.state} · {l.phone}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                        <QualityBadge q={l.quality} />
                        <StatusBadge s={l.status} />
                        {fu && (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                              fu.tone === "overdue"
                                ? "bg-clay/15 text-clay"
                                : fu.tone === "today"
                                ? "bg-gold/30 text-gold-foreground"
                                : fu.tone === "soon"
                                ? "bg-tan/30 text-tan-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {fu.label}
                          </span>
                        )}
                        {!isValidContactDate(l.lastContacted) && (
                          <span className="text-[10px] text-muted-foreground italic">Never contacted</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-2 lg:hidden" />
                  </button>
                  {onStartCall && (
                    <div className="px-4 pb-3 flex items-center gap-2 lg:hidden">
                      <a
                        href={`tel:${l.phone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary border border-border text-xs"
                      >
                        <Phone className="h-3 w-3" /> Dial
                      </a>
                      <button
                        onClick={() => { setActiveId(l.id); onStartCall(l); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-maroon text-maroon-foreground text-xs"
                      >
                        <Mic className="h-3 w-3" /> Call Assistant
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            {sorted.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground italic">
                No leads match your filters.
              </li>
            )}
          </ul>
        </div>

        {/* Right: detail */}
        <div
          className={`bg-background ${
            mobileOpen ? "block" : "hidden lg:block"
          }`}
        >
          <LeadDetail
            lead={active}
            inline
            backLabel="Queue"
            onClose={() => setMobileOpen(false)}
            onStartCall={onStartCall}
          />
        </div>
      </div>
    </div>
  );
}