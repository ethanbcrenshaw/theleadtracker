import type { Lead } from "@/lib/types";
import { STATUSES, statusClasses } from "@/lib/crm-utils";
import { QualityBadge } from "./Badges";

interface Props { leads: Lead[]; onView: (l: Lead) => void }

export function KanbanView({ leads, onView }: Props) {
  return (
    <div className="grid grid-flow-col auto-cols-[280px] gap-3 overflow-x-auto pb-4">
      {STATUSES.map((status) => {
        const items = leads.filter((l) => l.status === status);
        return (
          <div key={status} className="rounded-2xl bg-card border border-border p-3 shadow-soft min-h-[200px]">
            <div className="flex items-center justify-between mb-3">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${statusClasses(status)}`}>
                {status}
              </span>
              <span className="text-xs text-muted-foreground font-mono">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((l) => (
                <button
                  key={l.id}
                  onClick={() => onView(l)}
                  className="w-full text-left rounded-xl bg-background border border-border p-3 hover:border-navy/40 hover:shadow-soft transition-all"
                >
                  <div className="font-medium text-sm text-foreground">{l.business}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{l.city}, {l.state}</div>
                  <a href={`tel:${l.phone}`} className="text-xs font-mono text-navy mt-1 block" onClick={(e) => e.stopPropagation()}>
                    {l.phone}
                  </a>
                  <div className="flex items-center justify-between mt-2">
                    <QualityBadge q={l.quality} />
                    <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{l.websiteOpportunity}</span>
                  </div>
                </button>
              ))}
              {items.length === 0 && (
                <div className="text-xs text-muted-foreground italic text-center py-6">Empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
