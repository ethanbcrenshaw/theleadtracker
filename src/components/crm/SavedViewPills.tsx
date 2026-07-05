export type SavedView = "hot" | "followups" | "pipeline" | "all" | "analytics";

interface Props {
  view: SavedView;
  setView: (v: SavedView) => void;
  counts: Record<Exclude<SavedView, "analytics">, number>;
}

const PAD = (n: number) => String(n).padStart(3, "0");

const TABS: { id: SavedView; label: string }[] = [
  { id: "hot",       label: "Hot" },
  { id: "followups", label: "Follow-ups" },
  { id: "pipeline",  label: "Pipeline" },
  { id: "all",       label: "All" },
  { id: "analytics", label: "Analytics" },
];

export function SavedViewPills({ view, setView, counts }: Props) {
  return (
    <div className="border-b border-border flex items-end gap-8 overflow-x-auto">
      {TABS.map((t) => {
        const active = view === t.id;
        const count =
          t.id === "analytics" ? null : counts[t.id as Exclude<SavedView, "analytics">];
        return (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`mono py-3 -mb-px whitespace-nowrap border-b-2 transition-colors ${
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {count !== null && (
              <span className="ml-2 opacity-60">— {PAD(count)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}