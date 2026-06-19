import { Flame, CalendarClock, Workflow, Table2, BarChart3 } from "lucide-react";

export type SavedView = "hot" | "followups" | "pipeline" | "all" | "analytics";

interface Props {
  view: SavedView;
  setView: (v: SavedView) => void;
  counts: Record<Exclude<SavedView, "analytics">, number>;
}

const PILLS: { id: SavedView; label: string; icon: typeof Flame }[] = [
  { id: "hot", label: "Hot, not called", icon: Flame },
  { id: "followups", label: "Follow-ups due", icon: CalendarClock },
  { id: "pipeline", label: "Pipeline", icon: Workflow },
  { id: "all", label: "All leads", icon: Table2 },
];

export function SavedViewPills({ view, setView, counts }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex flex-wrap items-center gap-2">
        {PILLS.map((p) => {
          const active = view === p.id;
          const count = counts[p.id as Exclude<SavedView, "analytics">];
          return (
            <button
              key={p.id}
              onClick={() => setView(p.id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                active
                  ? "bg-navy text-navy-foreground border-navy shadow-soft"
                  : "bg-card text-foreground border-border hover:border-navy/40"
              }`}
            >
              <p.icon className="h-4 w-4" />
              {p.label}
              <span
                className={`inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-full text-[11px] font-semibold ${
                  active ? "bg-navy-foreground/15 text-navy-foreground" : "bg-secondary text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      <button
        onClick={() => setView("analytics")}
        className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium border transition-all ${
          view === "analytics"
            ? "bg-navy text-navy-foreground border-navy shadow-soft"
            : "bg-card text-muted-foreground border-border hover:border-navy/40 hover:text-foreground"
        }`}
      >
        <BarChart3 className="h-4 w-4" />
        Analytics
      </button>
    </div>
  );
}