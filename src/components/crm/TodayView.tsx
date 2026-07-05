import { useEffect, useMemo, useState } from "react";
import type { Lead } from "@/lib/types";
import { LeadDetail } from "./LeadDetail";
import { Botanical } from "./Botanical";

export type TodayReasonTone = "overdue" | "today" | "hot";

export interface TodayItem {
  lead: Lead;
  reason: string;
  tone: TodayReasonTone;
  sortKey: number;
}

interface Props {
  items: TodayItem[];
  onStartCall?: (lead: Lead) => void;
}

export function TodayView({ items, onStartCall }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (items.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !items.some((i) => i.lead.id === activeId)) {
      setActiveId(items[0].lead.id);
    }
  }, [items, activeId]);

  const active = items.find((i) => i.lead.id === activeId)?.lead ?? null;

  return (
    <div className="border border-border bg-card">
      <div className="grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] min-h-[70vh]">
        <div className={`border-border lg:border-r ${mobileOpen ? "hidden lg:block" : "block"}`}>
          <div className="px-5 py-3 border-b border-border mono text-muted-foreground flex items-center justify-between">
            <span>Today's Worklist</span>
            <span>— {String(items.length).padStart(3, "0")}</span>
          </div>
          <ul className="divide-y divide-border max-h-[75vh] overflow-y-auto">
            {items.map((it, i) => {
              const l = it.lead;
              const isActive = l.id === activeId;
              const reasonClass =
                it.tone === "overdue"
                  ? "text-[color:var(--sienna)]"
                  : it.tone === "today"
                    ? "text-foreground"
                    : "text-foreground";
              return (
                <li key={l.id}>
                  <button
                    onClick={() => { setActiveId(l.id); setMobileOpen(true); }}
                    className={`w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-foreground/[0.03] transition-colors ${
                      isActive ? "lg:bg-foreground/[0.05] lg:border-l-2 lg:border-foreground" : ""
                    }`}
                  >
                    <span className="mono text-muted-foreground w-8 shrink-0 pt-1">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={`mono ${reasonClass}`}>{it.reason}</div>
                      <div className="font-display text-xl text-foreground truncate leading-tight mt-1">
                        {l.business}
                      </div>
                      <div className="mono text-muted-foreground truncate mt-1.5">
                        {l.city}, {l.state}{l.phone ? ` — ${l.phone}` : ""}
                      </div>
                      {l.unverified && (
                        <div className="mono mt-1.5 text-[color:var(--sienna)]">
                          ⚠ UNVERIFIED — {(l.unverifiedReason || "review").toUpperCase()}
                        </div>
                      )}
                      {(l.confidenceEvidence?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {typeof l.confidenceScore === "number" && (
                            <span className="mono border border-foreground px-1.5 py-0.5 text-foreground">
                              CONF {String(l.confidenceScore).padStart(2, "0")}
                            </span>
                          )}
                          {l.confidenceEvidence!.slice(0, 3).map((chip, i) => (
                            <span key={i} className="mono border border-border px-1.5 py-0.5 text-muted-foreground">
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                  {onStartCall && (
                    <div className="px-5 pb-3 flex items-center gap-4 lg:hidden">
                      <a href={`tel:${l.phone}`} className="mono ink-link">[ DIAL ]</a>
                      <button
                        onClick={() => { setActiveId(l.id); onStartCall(l); }}
                        className="mono ink-link"
                      >
                        [ CALL ASSISTANT ]
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            {items.length === 0 && (
              <li className="px-4 py-16 flex flex-col items-center gap-5 text-center mono text-muted-foreground">
                <Botanical variant="sprig" className="h-28 w-24" opacity={0.8} />
                <div className="font-display text-3xl text-foreground lowercase">clear for today</div>
                <div>— nothing overdue, nothing scheduled, no hot leads waiting —</div>
              </li>
            )}
          </ul>
        </div>

        <div className={`bg-background ${mobileOpen ? "block" : "hidden lg:block"}`}>
          <LeadDetail
            lead={active}
            inline
            backLabel="[ TODAY ]"
            onClose={() => setMobileOpen(false)}
            onStartCall={onStartCall}
          />
        </div>
      </div>
    </div>
  );
}