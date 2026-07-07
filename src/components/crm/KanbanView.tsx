import type { Lead } from "@/lib/types";
import { STATUSES } from "@/lib/crm-utils";
import { QualityBadge, StatusBadge } from "./Badges";
import { BotanicalDivider } from "./Botanical";

interface Props { leads: Lead[]; onView: (l: Lead) => void }

export function KanbanView({ leads, onView }: Props) {
  return (
    <div className="space-y-4">
      <BotanicalDivider />
      <div className="grid grid-flow-col auto-cols-[280px] gap-3 overflow-x-auto pb-4">
      {STATUSES.map((status) => {
        const items = leads.filter((l) => l.status === status);
        return (
          <div key={status} className="border border-border p-3 min-h-[200px] bg-card">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-border tint-frog -m-3 mb-3 px-3 py-2">
              <StatusBadge s={status} />
              <span className="mono text-muted-foreground">{String(items.length).padStart(3, "0")}</span>
            </div>
            <div className="space-y-2">
              {items.map((l) => (
                <button
                  key={l.id}
                  onClick={() => onView(l)}
                  className="w-full text-left border border-border p-3 hover:border-foreground/40 transition-colors bg-background"
                >
                  <div className="font-display text-lg text-foreground leading-tight">{l.business}</div>
                  <div className="mono text-muted-foreground mt-1">{l.city}, {l.state}</div>
                  <a href={`tel:${l.phone}`} className="mono ink-link mt-2 inline-block" onClick={(e) => e.stopPropagation()}>
                    {l.phone}
                  </a>
                  <div className="flex items-center justify-between mt-2">
                    <QualityBadge q={l.quality} />
                    <span className="mono text-muted-foreground truncate max-w-[140px]">{l.websiteOpportunity}</span>
                  </div>
                </button>
              ))}
              {items.length === 0 && (
                <div className="mono text-muted-foreground text-center py-6">— empty —</div>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
