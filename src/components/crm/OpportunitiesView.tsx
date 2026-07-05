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
    <div className="space-y-8">
      {OPPORTUNITIES.map((op) => {
        const items = leads.filter((l) => l.websiteOpportunity === op);
        if (items.length === 0) return null;
        return (
          <section key={op}>
            <div className="border-b border-border pb-3 flex items-end justify-between">
              <div>
                <div className="mono text-muted-foreground">— Collection</div>
                <h3 className="font-display text-3xl text-foreground lowercase mt-1">{op.toLowerCase()}</h3>
                <p className="mono text-muted-foreground mt-2">{HINTS[op]}</p>
              </div>
              <span className="mono text-muted-foreground">{String(items.length).padStart(3, "0")}</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-0 border-b border-border">
              {items.map((l) => (
                <button
                  key={l.id}
                  onClick={() => onView(l)}
                  className="text-left border-r border-b border-border p-4 hover:bg-foreground/[0.03] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-lg truncate">{l.business}</span>
                    <QualityBadge q={l.quality} />
                  </div>
                  <div className="mono text-muted-foreground mt-1.5">{l.city}, {l.state}</div>
                  <div className="mt-3"><StatusBadge s={l.status} /></div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
