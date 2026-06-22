import { useEffect, useMemo, useState } from "react";
import { Mic, Phone, ChevronRight } from "lucide-react";
import type { Lead, WebsiteOpportunity } from "@/lib/types";
import { LeadDetail } from "./LeadDetail";
import { sortLeads } from "./LeadTable";
import { qualityFromOpportunity } from "@/lib/crm-utils";

interface Props {
  leads: Lead[];
  onStartCall?: (lead: Lead) => void;
  presorted?: boolean;
  emptyMessage?: string;
  title?: string;
}

function opportunityLabel(op: WebsiteOpportunity): string {
  switch (op) {
    case "No Dedicated Website":
      return "No website";
    case "Facebook Only":
      return "Facebook only";
    case "Yelp/Directory Only":
      return "Directory only";
    case "Outdated Website":
      return "Outdated site";
    case "Has Website":
      return "Has website";
    case "Social-Heavy":
      return "Social-heavy";
  }
}

function opportunityTagColors(op: WebsiteOpportunity): { bg: string; text: string } {
  const q = qualityFromOpportunity(op);
  if (q === "High") return { bg: "oklch(0.88 0.05 45)", text: "oklch(0.38 0.12 40)" };
  if (q === "Medium") return { bg: "oklch(0.90 0.04 80)", text: "oklch(0.40 0.05 55)" };
  return { bg: "oklch(0.91 0.02 80)", text: "oklch(0.35 0.01 60)" };
}

function OpportunityTag({ op }: { op: WebsiteOpportunity }) {
  const colors = opportunityTagColors(op);
  return (
    <span
      title={op}
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide max-w-[110px]"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      <span className="truncate">{opportunityLabel(op)}</span>
    </span>
  );
}

export function QueueView({ leads, onStartCall, presorted, emptyMessage, title }: Props) {
  const sorted = useMemo(
    () => (presorted ? leads : sortLeads(leads, "priority", "asc")),
    [leads, presorted]
  );
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
            {title ?? "Call Queue"} · {sorted.length}
          </div>
          <ul className="divide-y divide-border max-h-[75vh] overflow-y-auto">
            {sorted.map((l) => {
              const isActive = l.id === activeId;
              return (
                <li key={l.id}>
                  <button
                    onClick={() => handlePick(l)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-tan/10 transition-colors ${
                      isActive ? "lg:bg-tan/15 lg:border-l-2 lg:border-maroon" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground truncate">{l.business}</div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {l.city}, {l.state}
                      </div>
                    </div>
                    <OpportunityTag op={l.websiteOpportunity} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 lg:hidden" />
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
                {emptyMessage ?? "No leads match your filters."}
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
