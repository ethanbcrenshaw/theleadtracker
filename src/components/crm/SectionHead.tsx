import { Botanical } from "./Botanical";

interface Props {
  number?: string;
  label: string;
  italicTitle?: string;
  count?: number;
  right?: React.ReactNode;
  corner?: boolean;
  className?: string;
}

/**
 * Editorial section head — small numbered mono eyebrow, optional italic
 * lowercase serif title, double newspaper rule, optional decorative sprig
 * hanging off the top-right corner.
 */
export function SectionHead({ number, label, italicTitle, count, right, corner, className = "" }: Props) {
  return (
    <div className={`relative double-rule-b pb-3 ${className}`}>
      {corner && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-3 right-0 h-8 w-7 hidden sm:block"
        >
          <Botanical variant="sprig" opacity={0.55} />
        </div>
      )}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="mono text-muted-foreground">
            {number ? `${number} — ` : "— "}
            {label.toUpperCase()}
          </span>
          {italicTitle && (
            <span
              className="font-display italic lowercase text-foreground leading-none"
              style={{ fontSize: "28px" }}
            >
              {italicTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {right}
          {typeof count === "number" && (
            <span className="mono text-muted-foreground">— {String(count).padStart(3, "0")}</span>
          )}
        </div>
      </div>
    </div>
  );
}