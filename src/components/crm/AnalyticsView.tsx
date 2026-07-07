import type { Lead } from "@/lib/types";
import { isValidContactDate } from "@/lib/crm-utils";
import { SectionHead } from "./SectionHead";

interface Props { leads: Lead[] }

export function AnalyticsView({ leads }: Props) {
  const total = leads.length;
  const called = leads.filter((l) => l.status !== "Not Called").length;
  const notCalled = leads.filter((l) => l.status === "Not Called").length;
  const zooms = leads.filter((l) => l.status === "Zoom Booked").length;
  const sold = leads.filter((l) => l.status === "Sold").length;
  const high = leads.filter((l) => l.quality === "High").length;
  const followups = leads.filter(
    (l) =>
      isValidContactDate(l.nextFollowUp) &&
      new Date(l.nextFollowUp!).getTime() - Date.now() < 7 * 86400000
  ).length;
  const conversionRate = called > 0 ? Math.round((sold / called) * 100) : 0;

  const cells = [
    { label: "Total",         value: total },
    { label: "Calls Made",    value: called },
    { label: "Not Called",    value: notCalled },
    { label: "Zooms Booked",  value: zooms },
    { label: "Conversions",   value: sold },
    { label: "High Priority", value: high },
    { label: "Follow-ups 7d", value: followups },
    { label: "Conversion %",  value: `${conversionRate}%` },
  ];

  return (
    <div className="space-y-8">
      <SectionHead number="01" label="Analytics" italicTitle="the digest" corner count={total} />
      <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-b border-border divide-x divide-y sm:divide-y-0 divide-border">
        {cells.map((c, i) => (
          <div key={c.label} className={`px-5 py-6 ${i >= 4 ? "sm:border-t sm:border-border" : ""}`}>
            <div className="mono text-muted-foreground">{c.label}</div>
            <div className="font-display text-4xl mt-3 text-foreground leading-none">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}