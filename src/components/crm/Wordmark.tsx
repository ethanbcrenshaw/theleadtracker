import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

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
  const fontSize = 34;
  const h = 42;
  const before = "lead blo";
  const after = "m";
  const beforeRef = useRef<SVGTextElement | null>(null);
  const afterRef = useRef<SVGTextElement | null>(null);
  const [layout, setLayout] = useState<{ w: number; flowerX: number; afterX: number }>({
    w: 240,
    flowerX: 165,
    afterX: 180,
  });

  useLayoutEffect(() => {
    const measure = () => {
      const b = beforeRef.current;
      const a = afterRef.current;
      if (!b || !a) return;
      const beforeW = b.getComputedTextLength();
      const afterW = a.getComputedTextLength();
      // Flower occupies the visual space of one "o" character (~0.44em in this serif).
      const oWidth = fontSize * 0.42;
      const gap = fontSize * 0.02;
      const flowerX = beforeW + oWidth / 2;
      const afterX = beforeW + oWidth + gap;
      const total = afterX + afterW + 4;
      setLayout({ w: total, flowerX, afterX });
    };
    measure();
    // Re-measure once fonts finish loading (Instrument Serif is remote).
    const fonts = (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      fonts.ready.then(measure).catch(() => {});
    }
  }, []);

  const petalR = 5.4;
  const petalOffset = 5.2;
  const flowerY = fontSize * 0.42; // roughly the vertical center of a lowercase o
  const style: CSSProperties = { height: size, width: "auto", display: "block" };
  const textStyle: CSSProperties = {
    fontFamily: '"Instrument Serif", serif',
    fontSize: `${fontSize}px`,
    fontWeight: 400,
    letterSpacing: "-0.01em",
  };
  return (
    <svg
      viewBox={`0 0 ${layout.w} ${h}`}
      style={style}
      className={className}
      role="img"
      aria-label="lead bloom"
    >
      <text ref={beforeRef} x="0" y={fontSize * 0.85} fill="currentColor" style={textStyle}>
        {before}
      </text>
      <text ref={afterRef} x={layout.afterX} y={fontSize * 0.85} fill="currentColor" style={textStyle}>
        {after}
      </text>
      <g
        transform={`translate(${layout.flowerX} ${flowerY})`}
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
            rx="2.3"
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