import { useState } from "react";
import type { FilterState } from "./Filters";
import type { SavedFilterPreset } from "@/lib/savedFilters";

interface Props {
  presets: SavedFilterPreset[];
  onApply: (f: FilterState) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}

export function FilterPresets({ presets, onApply, onSave, onDelete }: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
    setNaming(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="mono text-muted-foreground min-w-[110px]">— Saved Views</span>
      {presets.map((p) => (
        <span key={p.id} className="mono inline-flex items-center gap-1.5 border border-border px-2.5 py-1">
          <button onClick={() => onApply(p.filters)} className="text-muted-foreground hover:text-foreground">
            {p.name}
          </button>
          <button
            onClick={() => onDelete(p.id)}
            aria-label={`Delete saved view ${p.name}`}
            className="text-muted-foreground hover:text-[color:var(--sienna)]"
          >
            ×
          </button>
        </span>
      ))}
      {naming ? (
        <span className="inline-flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="VIEW NAME"
            className="mono px-2 py-1 border border-foreground bg-transparent focus:outline-none w-32"
          />
          <button onClick={confirm} className="mono px-2 py-1 border border-foreground hover:bg-foreground hover:text-background">
            [ SAVE ]
          </button>
          <button onClick={() => setNaming(false)} className="mono px-2 py-1 border border-border hover:border-foreground">
            [ CANCEL ]
          </button>
        </span>
      ) : (
        <button
          onClick={() => setNaming(true)}
          className="mono px-2.5 py-1 border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
        >
          [ + SAVE VIEW ]
        </button>
      )}
    </div>
  );
}
