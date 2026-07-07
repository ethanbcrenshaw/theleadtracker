import { useEffect, useMemo, useState } from "react";
import type { Lead, WebsiteOpportunity } from "@/lib/types";
import { LeadDetail } from "./LeadDetail";
import { sortLeads } from "./LeadTable";
import { TagBadge, TierChip, EvidenceChip } from "./Badges";
import { Botanical } from "./Botanical";

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

function OpportunityTag({ op }: { op: WebsiteOpportunity }) {
  return (
    <span
      title={op}
      className="mono shrink-0 border border-border px-1.5 py-1 text-muted-foreground max-w-[130px] truncate"
    >
      {opportunityLabel(op)}
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
    <div className="border border-border bg-card">
      <div className="grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] min-h-[70vh]">
        {/* Left: list */}
        <div
          className={`border-border lg:border-r ${
            mobileOpen ? "hidden lg:block" : "block"
          }`}
        >
          <div className="px-5 py-3 border-b border-border mono text-muted-foreground flex items-center justify-between">
            <span>{title ?? "Call Queue"}</span>
            <span>— {String(sorted.length).padStart(3, "0")}</span>
          </div>
          <ul className="divide-y divide-border max-h-[75vh] overflow-y-auto">
            {sorted.map((l, i) => {
              const isActive = l.id === activeId;
              return (
                <li key={l.id}>
                  <button
                    onClick={() => handlePick(l)}
                    className={`w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-foreground/[0.03] transition-colors ${
                      isActive ? "lg:tint-frog lg:border-l-2 lg:border-[color:var(--frog-ink)]" : ""
                    }`}
                  >
                    <span className="mono text-muted-foreground w-8 shrink-0 pt-0.5">
                      {String(i + 1).padStart(3, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-xl text-foreground truncate leading-tight">
                        {l.business}
                      </div>
                      <div className="mono text-muted-foreground truncate mt-1.5">
                        {l.city}, {l.state}
                      </div>
                      {l.unverified && (
                        <div className="mono mt-1.5 text-[color:var(--sienna)]">
                          ⚠ UNVERIFIED — {(l.unverifiedReason || "review").toUpperCase()}
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
                          <TierChip tier={l.verificationTier} />
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
                    </div>
                    <OpportunityTag op={l.websiteOpportunity} />
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
            {sorted.length === 0 && (
              <li className="px-4 py-12 flex flex-col items-center gap-5 text-center mono text-muted-foreground">
                <Botanical variant="hip" className="h-24 w-20 opacity-90" opacity={0.75} />
                <div>{emptyMessage ?? "No leads match your filters."}</div>
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
            backLabel="[ QUEUE ]"
            onClose={() => setMobileOpen(false)}
            onStartCall={onStartCall}
          />
        </div>
      </div>
    </div>
  );
}
