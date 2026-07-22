import type { Quality, LeadStatus, LeadTier } from "@/lib/types";

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
    <span className="mono inline-flex items-center gap-1.5 whitespace-nowrap px-1.5 py-1 border border-border text-foreground">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {label}
    </span>
  );
}

function qualityDot(q: Quality): string {
  if (q === "High") return "var(--sienna)";
  if (q === "Medium") return "var(--frog-ink)";
  return "color-mix(in oklab, var(--foreground) 45%, transparent)";
}

function statusDot(s: LeadStatus): string {
  switch (s) {
    case "Not Called":
      return "color-mix(in oklab, var(--foreground) 25%, transparent)";
    case "Called":
      return "var(--frog-ink)";
    case "Voicemail":
      return "color-mix(in oklab, var(--foreground) 40%, transparent)";
    case "Callback Scheduled":
      return "var(--sienna)";
    case "Zoom Booked":
      return "var(--frog-ink)";
    case "Sold":
      return "var(--frog-ink)";
    case "Not Interested":
      return "color-mix(in oklab, var(--foreground) 30%, transparent)";
  }
}

export function QualityBadge({ q }: { q: Quality }) {
  return <DotTag label={q} dot={qualityDot(q)} />;
}

export function StatusBadge({ s }: { s: LeadStatus }) {
  return <DotTag label={s} dot={statusDot(s)} />;
}

/**
 * Verification-tier chip. Green for VERIFIED (positive/confirmed),
 * red for UNVERIFIED (warning), ink for PARTIAL (neutral).
 */
export function TierChip({
  tier,
}: {
  tier: "verified" | "partial" | "unverified" | null | undefined;
}) {
  if (!tier) return null;
  const cls =
    tier === "verified"
      ? "border-[color:var(--frog-ink)] text-[color:var(--frog-ink)]"
      : tier === "unverified"
        ? "border-[color:var(--sienna)] text-[color:var(--sienna)]"
        : "border-border text-muted-foreground";
  return <span className={`mono border px-1.5 py-0.5 ${cls}`}>{tier.toUpperCase()}</span>;
}

/**
 * Lead-tier badge (Furniture/Upholstery scoring spec). HOT is the strong,
 * call-first tier (frog-blue fill); WARM/COOL step down; COLD and
 * DISQUALIFIED read as red/muted so bad-fit leads are visually obvious.
 */
export function TierBadge({ tier, score }: { tier: LeadTier | null | undefined; score?: number }) {
  if (!tier) return null;
  const cls =
    tier === "hot"
      ? "border-[color:var(--frog-ink)] bg-[color:var(--frog-tint)] text-[color:var(--frog-ink)]"
      : tier === "warm"
        ? "border-[color:var(--frog-ink)] text-[color:var(--frog-ink)]"
        : tier === "cool"
          ? "border-border text-foreground"
          : tier === "disqualified"
            ? "border-[color:var(--sienna)] text-[color:var(--sienna)]"
            : "border-border text-muted-foreground";
  return (
    <span className={`mono border px-1.5 py-0.5 font-medium ${cls}`}>
      {tier.toUpperCase()}
      {typeof score === "number" && tier !== "disqualified" ? ` · ${score}` : ""}
    </span>
  );
}

/**
 * Evidence chip — chips that confirm health (phone matches FB/GMB, site
 * verified live, etc.) render in green. Others stay ink-muted.
 */
export function EvidenceChip({ label }: { label: string }) {
  const positive =
    /(matches?|verified|live|reachable|confirmed|found)/i.test(label) &&
    !/(no|not|missing|failed|unreachable|didn't|closed|mismatch)/i.test(label);
  const cls = positive
    ? "border-[color:var(--frog-ink)] text-[color:var(--frog-ink)]"
    : "border-border text-muted-foreground";
  return <span className={`mono border px-1.5 py-0.5 ${cls}`}>{label}</span>;
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
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove tag ${label}`}
          className="hover:text-[color:var(--sienna)]"
        >
          ×
        </button>
      )}
    </Comp>
  );
}
