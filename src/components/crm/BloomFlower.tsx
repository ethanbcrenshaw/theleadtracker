import { type CSSProperties } from "react";

type Props = {
  className?: string;
  style?: CSSProperties;
};

/**
 * Fine-line botanical sketch that draws itself on mount, then settles into a
 * near-imperceptible sway. Decorative only (aria-hidden). Respects
 * prefers-reduced-motion via CSS.
 *
 * Colors: ink strokes + a mid-gray secondary layer. No fills except an
 * optional tiny stamen dot.
 */
export function BloomFlower({ className, style }: Props) {
  return (
    <>
      <style>{css}</style>
      <svg
        aria-hidden="true"
        viewBox="0 0 220 320"
        className={`bloom-flower ${className ?? ""}`}
        style={{ pointerEvents: "none", ...style }}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Sway group — rotates around the base of the stem */}
        <g className="bf-sway" style={{ transformOrigin: "110px 310px" }}>
          {/* Stem — draws first */}
          <path
            className="bf-stroke bf-stem"
            d="M110 310 C 108 260, 118 220, 108 180 C 100 148, 116 120, 110 90"
            stroke="currentColor"
            strokeWidth="1.2"
          />

          {/* Leaves — draw after stem */}
          <g className="bf-stroke bf-leafA">
            <path
              d="M112 235 C 140 228, 158 236, 170 250 C 152 254, 130 250, 114 244"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="M120 240 C 140 244, 158 250, 168 250"
              stroke="var(--muted-foreground)"
              strokeWidth="0.75"
              opacity="0.6"
            />
          </g>
          <g className="bf-stroke bf-leafB">
            <path
              d="M108 195 C 82 188, 62 196, 50 210 C 68 214, 90 210, 106 204"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="M100 200 C 82 204, 68 210, 54 210"
              stroke="var(--muted-foreground)"
              strokeWidth="0.75"
              opacity="0.6"
            />
          </g>
          <g className="bf-stroke bf-leafC">
            <path
              d="M110 150 C 132 140, 152 148, 164 162 C 146 166, 126 162, 112 156"
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>

          {/* Petals — draw last, breathing subtly */}
          <g className="bf-bloom" style={{ transformOrigin: "110px 90px" }}>
            {[0, 60, 120, 180, 240, 300].map((deg, i) => (
              <ellipse
                key={deg}
                className={`bf-stroke bf-petal bf-petal-${i}`}
                cx="110"
                cy="70"
                rx="10"
                ry="22"
                stroke="currentColor"
                strokeWidth="1.1"
                transform={`rotate(${deg} 110 90)`}
              />
            ))}
            {/* Secondary lighter petal layer for depth */}
            {[30, 90, 150, 210, 270, 330].map((deg, i) => (
              <ellipse
                key={deg}
                className={`bf-stroke bf-petal bf-petal-alt-${i}`}
                cx="110"
                cy="75"
                rx="6"
                ry="16"
                stroke="var(--muted-foreground)"
                strokeWidth="0.75"
                opacity="0.55"
                transform={`rotate(${deg} 110 90)`}
              />
            ))}
            {/* Center */}
            <circle
              className="bf-stroke bf-center"
              cx="110"
              cy="90"
              r="4.5"
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>
        </g>
      </svg>
    </>
  );
}

const css = `
.bloom-flower .bf-stroke {
  stroke-dasharray: 400;
  stroke-dashoffset: 400;
  animation: bf-draw 1.6s ease-out forwards;
}
.bloom-flower .bf-stem { animation-delay: 0.05s; animation-duration: 1.4s; }
.bloom-flower .bf-leafA { animation-delay: 0.9s; animation-duration: 1.0s; }
.bloom-flower .bf-leafB { animation-delay: 1.15s; animation-duration: 1.0s; }
.bloom-flower .bf-leafC { animation-delay: 1.35s; animation-duration: 1.0s; }
.bloom-flower .bf-petal { animation-delay: 1.7s; animation-duration: 1.1s; }
.bloom-flower .bf-petal-1 { animation-delay: 1.78s; }
.bloom-flower .bf-petal-2 { animation-delay: 1.86s; }
.bloom-flower .bf-petal-3 { animation-delay: 1.94s; }
.bloom-flower .bf-petal-4 { animation-delay: 2.02s; }
.bloom-flower .bf-petal-5 { animation-delay: 2.10s; }
.bloom-flower .bf-petal-alt-0,
.bloom-flower .bf-petal-alt-1,
.bloom-flower .bf-petal-alt-2,
.bloom-flower .bf-petal-alt-3,
.bloom-flower .bf-petal-alt-4,
.bloom-flower .bf-petal-alt-5 { animation-delay: 2.4s; animation-duration: 0.9s; }
.bloom-flower .bf-center { animation-delay: 2.9s; animation-duration: 0.6s; }

.bloom-flower .bf-sway {
  animation: bf-sway 9s ease-in-out 3.4s infinite alternate;
}
.bloom-flower .bf-bloom {
  animation: bf-breathe 6s ease-in-out 3.4s infinite alternate;
}

@keyframes bf-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes bf-sway {
  0%   { transform: rotate(-1.2deg); }
  100% { transform: rotate(1.2deg); }
}
@keyframes bf-breathe {
  0%   { transform: scale(1); }
  100% { transform: scale(1.015); }
}

@media (prefers-reduced-motion: reduce) {
  .bloom-flower .bf-stroke {
    stroke-dasharray: none;
    stroke-dashoffset: 0;
    animation: none;
  }
  .bloom-flower .bf-sway,
  .bloom-flower .bf-bloom { animation: none; }
}
`;