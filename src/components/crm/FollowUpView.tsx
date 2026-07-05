import type { Lead } from "@/lib/types";
import { formatDate, isValidContactDate, relativeFollowUp } from "@/lib/crm-utils";
import { QualityBadge, StatusBadge } from "./Badges";

export function FollowUpView({ leads, onView }: { leads: Lead[]; onView: (l: Lead) => void }) {
  const withFollowup = leads
    .filter((l) => l.nextFollowUp || l.status === "Callback Scheduled")
    .sort((a, b) => (new Date(a.nextFollowUp ?? 0).getTime() - new Date(b.nextFollowUp ?? 0).getTime()));

  if (withFollowup.length === 0) {
    return (
      <div className="border border-border p-12 text-center text-muted-foreground bg-card">
        Nothing scheduled. Open a lead and set a follow-up date to see it here.
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {withFollowup.map((l, i) => {
        const r = relativeFollowUp(l.nextFollowUp, l.lastContacted);
        return (
          <button
            key={l.id}
            onClick={() => onView(l)}
            className="w-full text-left border-b border-border py-4 px-2 hover:bg-foreground/[0.03] transition-colors flex items-center gap-6"
          >
            <span className="mono text-muted-foreground w-10 shrink-0">{String(i + 1).padStart(3, "0")}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-xl text-foreground">{l.business}</span>
                <QualityBadge q={l.quality} />
                <StatusBadge s={l.status} />
              </div>
              <div className="mono text-muted-foreground mt-1.5">
                {l.city}, {l.state} · LAST — {isValidContactDate(l.lastContacted) ? formatDate(l.lastContacted) : "NEVER"}
              </div>
              {l.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{l.notes}</p>}
            </div>
            <div className="text-right">
              <div className="mono text-muted-foreground">{formatDate(l.nextFollowUp)}</div>
              {r && (
                <div className={`mono mt-1 ${r.tone === "overdue" ? "text-[color:var(--sienna)]" : "text-foreground"}`}>{r.label}</div>
              )}
              <a
                href={`tel:${l.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="mono ink-link mt-2 inline-block"
              >
                [ CALL ]
              </a>
            </div>
          </button>
        );
      })}
    </div>
  );
}
