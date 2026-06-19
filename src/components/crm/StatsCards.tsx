import { Phone, PhoneOff, Video, Trophy, Flame, CalendarClock, Users } from "lucide-react";
import type { Lead } from "@/lib/types";
import { isValidContactDate } from "@/lib/crm-utils";

interface Props { leads: Lead[] }

export function StatsCards({ leads }: Props) {
  const total = leads.length;
  const called = leads.filter((l) => l.status !== "Not Called").length;
  const notCalled = leads.filter((l) => l.status === "Not Called").length;
  const zooms = leads.filter((l) => l.status === "Zoom Booked").length;
  const sold = leads.filter((l) => l.status === "Sold").length;
  const high = leads.filter((l) => l.quality === "High").length;
  const followups = leads.filter(
    (l) =>
      isValidContactDate(l.nextFollowUp) &&
      isValidContactDate(l.lastContacted) &&
      new Date(l.nextFollowUp!).getTime() - Date.now() < 7 * 86400000
  ).length;

  const cards = [
    { label: "Total Leads", value: total, icon: Users, tone: "navy" },
    { label: "Calls Made", value: called, icon: Phone, tone: "sage" },
    { label: "Not Called", value: notCalled, icon: PhoneOff, tone: "tan" },
    { label: "Zooms Booked", value: zooms, icon: Video, tone: "gold" },
    { label: "Conversions", value: sold, icon: Trophy, tone: "sage" },
    { label: "High Priority", value: high, icon: Flame, tone: "clay" },
    { label: "Follow-ups Due", value: followups, icon: CalendarClock, tone: "gold" },
  ] as const;

  const toneBg: Record<string, string> = {
    navy: "bg-navy/10 text-navy",
    sage: "bg-sage/20 text-sage-foreground",
    tan: "bg-tan/30 text-tan-foreground",
    gold: "bg-gold/25 text-gold-foreground",
    clay: "bg-clay/15 text-clay",
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-2xl bg-card border border-border p-4 shadow-soft hover:shadow-elev transition-shadow"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {c.label}
            </span>
            <span className={`h-8 w-8 rounded-full grid place-items-center ${toneBg[c.tone]}`}>
              <c.icon className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 font-display text-3xl font-medium text-foreground">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
