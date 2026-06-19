import type { Lead } from "@/lib/types";
import { formatDate, isValidContactDate, relativeFollowUp } from "@/lib/crm-utils";
import { QualityBadge, StatusBadge } from "./Badges";
import { Phone } from "lucide-react";

export function FollowUpView({ leads, onView }: { leads: Lead[]; onView: (l: Lead) => void }) {
  const withFollowup = leads
    .filter((l) => l.nextFollowUp || l.status === "Callback Scheduled")
    .sort((a, b) => (new Date(a.nextFollowUp ?? 0).getTime() - new Date(b.nextFollowUp ?? 0).getTime()));

  if (withFollowup.length === 0) {
    return (
      <div className="rounded-2xl bg-card border border-border p-12 text-center text-muted-foreground">
        Nothing scheduled. Open a lead and set a follow-up date to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground italic px-1">Follow up before the lead goes cold.</p>
      {withFollowup.map((l) => {
        const r = relativeFollowUp(l.nextFollowUp, l.lastContacted);
        const tone = r?.tone === "overdue" ? "border-clay/50" : r?.tone === "today" ? "border-gold/50" : "border-border";
        return (
          <button
            key={l.id}
            onClick={() => onView(l)}
            className={`w-full text-left rounded-2xl bg-card border ${tone} p-4 shadow-soft hover:shadow-elev transition-all flex items-center gap-4`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground">{l.business}</span>
                <QualityBadge q={l.quality} />
                <StatusBadge s={l.status} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {l.city}, {l.state} · Last: {isValidContactDate(l.lastContacted) ? formatDate(l.lastContacted) : "Never"}
              </div>
              {l.notes && <p className="text-xs text-foreground/70 mt-1 line-clamp-1">{l.notes}</p>}
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">{formatDate(l.nextFollowUp)}</div>
              {r && (
                <div className={`text-xs font-medium mt-0.5 ${
                  r.tone === "overdue" ? "text-clay" : r.tone === "today" ? "text-gold-foreground" : "text-foreground"
                }`}>{r.label}</div>
              )}
              <a href={`tel:${l.phone}`} onClick={(e) => e.stopPropagation()}
                 className="inline-flex items-center gap-1 mt-2 text-xs text-navy font-mono">
                <Phone className="h-3 w-3" />{l.phone}
              </a>
            </div>
          </button>
        );
      })}
    </div>
  );
}
