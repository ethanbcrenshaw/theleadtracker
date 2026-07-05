import { type CSSProperties } from "react";

type Props = {
  className?: string;
  size?: number;
  accent?: boolean;
};

/**
 * "lead bloom" wordmark. Instrument Serif lowercase, ink strokes.
 * The second "o" of "bloom" is replaced by a fine 5-petal line-drawn flower;
 * its tiny center dot is the only red accent (optional).
 */
export function Wordmark({ className, size = 22, accent = true }: Props) {
  // Layout tuned so the flower sits in the visual weight of an "o".
  // Total viewBox width chosen empirically for Instrument Serif metrics.
  const h = 40;
  const w = 250;
  // Positions tuned for Instrument Serif at fontSize 34.
  const leftText = "lead bloo";
  const rightText = "m";
  const flowerCx = 195;
  const rightX = 210;
  const flowerCy = 20;
  const petalR = 5.4;
  const petalOffset = 5.4;
  const style: CSSProperties = {
    height: size,
    width: "auto",
    display: "block",
  };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={style}
      className={className}
      role="img"
      aria-label="lead bloom"
    >
      <text
        x="0"
        y="30"
        fill="currentColor"
        style={{
          fontFamily: '"Instrument Serif", serif',
          fontSize: "34px",
          fontWeight: 400,
          letterSpacing: "-0.01em",
        }}
      >
        {leftText}
      </text>
      <text
        x={rightX}
        y="30"
        fill="currentColor"
        style={{
          fontFamily: '"Instrument Serif", serif',
          fontSize: "34px",
          fontWeight: 400,
          letterSpacing: "-0.01em",
        }}
      >
        {rightText}
      </text>
      {/* Fine line flower in place of the last "o" */}
      <g
        transform={`translate(${flowerCx} ${flowerCy})`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      >
        {[0, 72, 144, 216, 288].map((deg) => (
          <ellipse
            key={deg}
            cx="0"
            cy={-petalOffset}
            rx="2.4"
            ry={petalR}
            transform={`rotate(${deg})`}
          />
        ))}
        <circle
          cx="0"
          cy="0"
          r="1.3"
          fill={accent ? "var(--sienna)" : "currentColor"}
          stroke="none"
        />
      </g>
    </svg>
  );
}