import type { DriftNarrative } from "@/lib/drift";

const NARRATIVE_COLOR: Record<DriftNarrative, string> = {
  steady: "#0d9488", // brand-teal
  drifting: "#f59e0b", // brand-amber
  "needs attention": "#f87171", // red-400
};

/** Hand-rolled SVG arc — no chart library in this codebase. */
export function GaugeRing({
  magnitude,
  narrative,
}: {
  magnitude: number;
  narrative: DriftNarrative;
}) {
  const size = 140;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - magnitude / 100);
  const color = NARRATIVE_COLOR[narrative];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        className="rotate-90"
        style={{ transformOrigin: "center", fill: "white", fontSize: 28 }}
      >
        {magnitude}
      </text>
    </svg>
  );
}
