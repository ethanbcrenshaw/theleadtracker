import type { Lead } from "@/lib/types";
import { OPPORTUNITIES } from "@/lib/crm-utils";
import { QualityBadge, StatusBadge } from "./Badges";

const HINTS: Record<string, string> = {
  "No Dedicated Website": "Highest leverage — start here.",
  "Facebook Only": "Facebook-only businesses are often strong website prospects.",
  "Yelp/Directory Only": "Their brand is scattered across listings — unify it.",
  "Outdated Website": "Pitch a refresh: trust + mobile + speed.",
  "Social-Heavy": "Capture their existing audience with a real hub.",
  "Has Website": "Lower priority unless they want a refresh.",
};

export function OpportunitiesView({ leads, onView }: { leads: Lead[]; onView: (l: Lead) => void }) {
  return (
    <div className="space-y-4">
      {OPPORTUNITIES.map((op) => {
        const items = leads.filter((l) => l.websiteOpportunity === op);
        if (items.length === 0) return null;
        return (
          <div key={op} className="rounded-2xl bg-card border border-border shadow-soft overflow-hidden">
            <div className="px-5 py-3 bg-secondary/50 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg text-foreground">{op}</h3>
                <p className="text-xs text-muted-foreground">{HINTS[op]}</p>
              </div>
              <span className="text-xs font-mono text-muted-foreground">{items.length} leads</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
              {items.map((l) => (
                <button
                  key={l.id}
                  onClick={() => onView(l)}
                  className="text-left rounded-xl bg-background border border-border p-3 hover:border-navy/40 transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{l.business}</span>
                    <QualityBadge q={l.quality} />
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{l.city}, {l.state}</div>
                  <div className="mt-2"><StatusBadge s={l.status} /></div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
