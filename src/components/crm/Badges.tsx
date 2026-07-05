import type { Quality, LeadStatus } from "@/lib/types";

/**
 * Small rectangular ink-tag with a colored dot. Editorial print-catalog styling.
 */
function DotTag({ label, dot }: { label: string; dot: string }) {
  // Red-emphasis items render as red text with no dot — vintage editorial
  // poster style — instead of a colored blob next to ink text.
  const isRed = dot.includes("--sienna");
  if (isRed) {
    return (
      <span className="mono inline-flex items-center whitespace-nowrap px-1.5 py-1 border border-[color:var(--sienna)] text-[color:var(--sienna)]">
        {label}
      </span>
    );
  }
  return (
    <span
      className="mono inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-1 border border-border text-foreground"
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: dot }}
      />
      {label}
    </span>
  );
}

function qualityDot(q: Quality): string {
  if (q === "High") return "var(--sienna)";
  if (q === "Medium") return "var(--olive)";
  return "color-mix(in oklab, var(--foreground) 45%, transparent)";
}

function statusDot(s: LeadStatus): string {
  switch (s) {
    case "Not Called":     return "color-mix(in oklab, var(--foreground) 25%, transparent)";
    case "Called":         return "var(--olive)";
    case "Voicemail":      return "color-mix(in oklab, var(--foreground) 40%, transparent)";
    case "Callback Scheduled": return "var(--sienna)";
    case "Zoom Booked":    return "var(--olive)";
    case "Sold":           return "var(--olive)";
    case "Not Interested": return "color-mix(in oklab, var(--foreground) 30%, transparent)";
  }
}

export function QualityBadge({ q }: { q: Quality }) {
  return <DotTag label={q} dot={qualityDot(q)} />;
}

export function StatusBadge({ s }: { s: LeadStatus }) {
  return <DotTag label={s} dot={statusDot(s)} />;
}

/**
 * Plain rectangular tag chip — no color coding, since tags are free-form
 * and shouldn't compete with the fixed quality/status dot palette.
 */
export function TagBadge({
  label,
  onRemove,
  active,
  onClick,
}: {
  label: string;
  onRemove?: () => void;
  active?: boolean;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      onClick={onClick}
      className={`mono inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-1 border transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
      }`}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label={`Remove tag ${label}`}
          className="hover:text-[color:var(--sienna)]"
        >
          ×
        </button>
      )}
    </Comp>
  );
}
