import type { Quality, LeadStatus } from "@/lib/types";
import { qualityClasses, statusClasses } from "@/lib/crm-utils";

export function QualityBadge({ q }: { q: Quality }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${qualityClasses(q)}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {q}
    </span>
  );
}

export function StatusBadge({ s }: { s: LeadStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${statusClasses(s)}`}>
      {s}
    </span>
  );
}
