import { useState } from "react";
import type { FilterState } from "@/components/crm/Filters";

export interface SavedFilterPreset {
  id: string;
  name: string;
  filters: FilterState;
}

const KEY = "lead-mgmt-saved-filters-v1";

function read(): SavedFilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(presets: SavedFilterPreset[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
}

export function useSavedFilters() {
  const [presets, setPresets] = useState<SavedFilterPreset[]>(() => read());

  const save = (name: string, filters: FilterState) => {
    setPresets((prev) => {
      const next = [...prev, { id: crypto.randomUUID(), name, filters }];
      write(next);
      return next;
    });
  };

  const remove = (id: string) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      write(next);
      return next;
    });
  };

  return { presets, save, remove };
}
