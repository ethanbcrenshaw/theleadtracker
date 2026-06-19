import { Flame, CalendarClock } from "lucide-react";
import type { Lead } from "@/lib/types";
import { isValidContactDate } from "@/lib/crm-utils";

interface Props { leads: Lead[]; onOpenAnalytics?: () => void }

export function StatsCards({ leads }: Props) {
  const toContact = leads.filter(
    (l) => l.quality === "High" && l.status === "Not Called"
  ).length;

  const endOfToday = (() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  })();

  const followupsDue = leads.filter(
    (l) =>
      isValidContactDate(l.nextFollowUp) &&
      new Date(l.nextFollowUp!).getTime() <= endOfToday
  ).length;

  const cards = [
    {
      label: "To Contact",
      hint: "High-quality leads, not yet called",
      value: toContact,
      icon: Flame,
      tone: "clay",
    },
    {
      label: "Follow-ups Due",
      hint: "Due today or overdue",
      value: followupsDue,
      icon: CalendarClock,
      tone: "gold",
    },
  ] as const;

  const toneBg: Record<string, string> = {
    clay: "bg-clay/15 text-clay",
    gold: "bg-gold/25 text-gold-foreground",
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl bg-card border border-border p-5 shadow-soft hover:shadow-elev transition-shadow"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {c.label}
              </div>
              <div className="text-[11px] text-muted-foreground/80 mt-0.5">{c.hint}</div>
            </div>
            <span className={`h-9 w-9 rounded-full grid place-items-center ${toneBg[c.tone]}`}>
              <c.icon className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-3 font-display text-4xl font-medium text-foreground">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
