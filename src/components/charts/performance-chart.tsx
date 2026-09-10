"use client";

import { useState } from "react";

export type ChartDataPoint = {
  label: string;
  value: number;
  secondaryValue?: number;
};

export function PerformanceAreaChart({
  data,
  height = 160,
  valuePrefix = "",
  valueSuffix = "",
  color = "teal",
}: {
  data: ChartDataPoint[];
  height?: number;
  valuePrefix?: string;
  valueSuffix?: string;
  color?: "teal" | "purple" | "amber";
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground"
      >
        No trend data available
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values, 0);
  const maxVal = Math.max(...values, 1);
  const range = maxVal - minVal || 1;

  const width = 600;
  const paddingX = 20;
  const paddingY = 20;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = paddingX + i * stepX;
    const y = paddingY + chartH - ((d.value - minVal) / range) * chartH;
    return { x, y, data: d };
  });

  const pathD = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cpX1 = prev.x + (p.x - prev.x) / 2;
    const cpY1 = prev.y;
    const cpX2 = prev.x + (p.x - prev.x) / 2;
    const cpY2 = p.y;
    return `${acc} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p.x} ${p.y}`;
  }, "");

  const areaD = `${pathD} L ${points[points.length - 1].x} ${paddingY + chartH} L ${points[0].x} ${paddingY + chartH} Z`;

  const strokeColor =
    color === "teal"
      ? "#10B981"
      : color === "purple"
        ? "#8B5CF6"
        : "#F59E0B";

  const gradientId = `perf-grad-${color}`;

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible"
        style={{ height }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={strokeColor} stopOpacity={0.28} />
            <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.5, 1].map((ratio) => {
          const y = paddingY + chartH * ratio;
          return (
            <line
              key={ratio}
              x1={paddingX}
              y1={y}
              x2={width - paddingX}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill={`url(#${gradientId})`} />

        {/* Curve stroke */}
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2.5}
          strokeLinecap="round"
        />

        {/* Data points & hover triggers */}
        {points.map((p, i) => {
          const isHovered = hoverIndex === i;
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isHovered ? 5 : 3}
                fill={strokeColor}
                className="transition-all duration-150"
              />
              <rect
                x={p.x - stepX / 2}
                y={0}
                width={stepX}
                height={height}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
              />
            </g>
          );
        })}
      </svg>

      {/* Hover Tooltip */}
      {activePoint ? (
        <div
          className="pointer-events-none absolute -top-10 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-lg backdrop-blur"
          style={{
            left: `${(activePoint.x / width) * 100}%`,
          }}
        >
          <div className="font-medium text-foreground">
            {valuePrefix}
            {activePoint.data.value.toLocaleString()}
            {valueSuffix}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {activePoint.data.label}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PerformanceBarChart({
  data,
  height = 140,
  valueSuffix = "",
}: {
  data: ChartDataPoint[];
  height?: number;
  valueSuffix?: string;
}) {
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex h-full flex-col justify-between space-y-3" style={{ height }}>
      <div className="flex h-full items-end gap-3 pt-4">
        {data.map((d, i) => {
          const pct = Math.max(8, (d.value / maxVal) * 100);
          return (
            <div
              key={i}
              className="group flex flex-1 flex-col items-center gap-1.5"
            >
              <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
                {d.value}
                {valueSuffix}
              </span>
              <div className="relative h-24 w-full overflow-hidden rounded-t-md bg-accent/40">
                <div
                  className="absolute bottom-0 w-full rounded-t-md bg-brand-teal transition-all duration-300 group-hover:brightness-110"
                  style={{ height: `${pct}%` }}
                />
              </div>
              <span className="truncate text-[10px] text-muted-foreground/70">
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
