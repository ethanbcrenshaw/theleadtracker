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

  const total = leads.length;
  const inPipeline = leads.filter(
    (l) => l.status === "Called" || l.status === "Callback Scheduled" || l.status === "Zoom Booked"
  ).length;

  const cells = [
    { label: "To Contact",     value: toContact,    hint: "High quality · not yet called" },
    { label: "Follow-ups Due", value: followupsDue, hint: "Due today or overdue" },
    { label: "In Pipeline",    value: inPipeline,   hint: "Called · callback · zoom" },
    { label: "Collection",     value: total,        hint: "All leads on file" },
  ];

  return (
    <div className="border-t border-b border-border grid grid-cols-2 lg:grid-cols-4 divide-x divide-border">
      {cells.map((c) => (
        <div key={c.label} className="px-6 py-8">
          <div className="mono text-muted-foreground">{c.label}</div>
          <div className="font-display text-5xl sm:text-6xl mt-3 text-foreground leading-none">
            {String(c.value).padStart(2, "0")}
          </div>
          <div className="mono text-muted-foreground mt-3">{c.hint}</div>
        </div>
      ))}
    </div>
  );
}
