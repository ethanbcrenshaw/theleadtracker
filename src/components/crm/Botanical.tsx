// Vintage botanical line-art engravings.
//
// Source: Nathaniel Lord Britton & Addison Brown, "An Illustrated Flora of
// the Northern United States, Canada and the British Possessions" (1913),
// plate for Rosa blanda (smooth rose). Public domain (US, pre-1928).
// Retrieved from Wikimedia Commons:
//   https://commons.wikimedia.org/wiki/File:Rosa_blanda_BB-1913.png
// The scan was recolored to pure black line-art on a transparent background
// and cropped into three variants (full plant, berry-cluster sprig, hip).
import roseFull from "@/assets/rose-lineart.png.asset.json";
import roseSprig from "@/assets/rose-sprig.png.asset.json";
import roseHip from "@/assets/rose-hip.png.asset.json";

type Variant = "masthead" | "sprig" | "hip";

const SOURCES: Record<Variant, string> = {
  masthead: roseFull.url,
  sprig: roseSprig.url,
  hip: roseHip.url,
};

// Position of the single hand-tinted red spot (rose hip / berry), expressed
// as percentages of the illustration's bounding box.
const SPOT: Record<Variant, { top: string; left: string; size: string } | null> = {
  masthead: { top: "72%", left: "80%", size: "6%" },
  sprig: { top: "36%", left: "50%", size: "10%" },
  hip: { top: "72%", left: "55%", size: "26%" },
};

type Props = {
  variant: Variant;
  className?: string;
  /** 0–1. Line-art opacity. Defaults tuned per variant. */
  opacity?: number;
  /** Show the small red hand-tinted accent spot. */
  tinted?: boolean;
  ariaHidden?: boolean;
};

export function Botanical({
  variant,
  className = "",
  opacity,
  tinted = true,
  ariaHidden = true,
}: Props) {
  const defaultOpacity =
    variant === "masthead" ? 0.18 : variant === "sprig" ? 0.55 : 0.7;
  const o = opacity ?? defaultOpacity;
  const spot = tinted ? SPOT[variant] : null;

  return (
    <div
      aria-hidden={ariaHidden}
      className={`relative pointer-events-none select-none ${className}`}
    >
      <img
        src={SOURCES[variant]}
        alt=""
        className="block h-full w-full object-contain dark:invert"
        style={{ opacity: o }}
        draggable={false}
      />
      {spot && (
        <span
          className="absolute rounded-full mix-blend-multiply dark:mix-blend-normal"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.size,
            paddingBottom: spot.size,
            transform: "translate(-50%, -50%)",
            background:
              "radial-gradient(circle at 40% 35%, color-mix(in oklab, var(--sienna) 95%, transparent) 0%, color-mix(in oklab, var(--sienna) 70%, transparent) 55%, color-mix(in oklab, var(--sienna) 0%, transparent) 78%)",
            opacity: Math.min(1, o * 3.5),
          }}
        />
      )}
    </div>
  );
}

/**
 * Thin decorative divider with a small centered sprig — for use between
 * major sections. Hairline rule left and right, engraving centered.
 */
export function BotanicalDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-6 my-2 ${className}`} aria-hidden>
      <div className="flex-1 border-t border-border" />
      <Botanical variant="sprig" className="h-10 w-16 shrink-0" opacity={0.6} />
      <div className="flex-1 border-t border-border" />
    </div>
  );
}