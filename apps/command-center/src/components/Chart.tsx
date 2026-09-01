/**
 * Chart — small dependency-free SVG chart with bar, line, and sparkline
 * variants. Accessible: role="img" plus a caller-supplied aria-label
 * summarizing the series. Handles empty data by rendering a labelled
 * placeholder instead of a broken plot.
 */

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface ChartProps {
  variant: "bar" | "line" | "sparkline";
  series: ChartSeries[];
  /** X-axis labels, one per data point (bar/line variants). */
  labels?: string[];
  ariaLabel: string;
  height?: number;
  /** Left padding, widen for long money tick labels. */
  padLeft?: number;
  /** Formats y-axis tick values. */
  formatValue?: (v: number) => string;
}

const DEFAULT_COLORS = ["#2563eb", "#0d9488", "#d97706", "#dc2626"];

function seriesColor(s: ChartSeries, i: number): string {
  return s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] ?? "#2563eb";
}

export function Chart({
  variant,
  series,
  labels = [],
  ariaLabel,
  height,
  padLeft,
  formatValue = (v) => v.toLocaleString("en-US"),
}: ChartProps) {
  const pointCount = series.reduce((n, s) => Math.max(n, s.values.length), 0);
  const hasData = series.length > 0 && pointCount > 0;

  if (variant === "sparkline") {
    const w = 120;
    const h = 30;
    if (!hasData) {
      return (
        <svg role="img" aria-label={ariaLabel} width={w} height={h} className="chart chart-sparkline">
          <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2} stroke="#cbd5e1" strokeDasharray="3 3" />
        </svg>
      );
    }
    const s = series[0];
    const values = s ? s.values : [];
    const max = Math.max(1, ...values);
    const step = values.length > 1 ? (w - 8) / (values.length - 1) : 0;
    const points = values
      .map((v, i) => `${(4 + i * step).toFixed(1)},${(h - 4 - (v / max) * (h - 8)).toFixed(1)}`)
      .join(" ");
    return (
      <svg role="img" aria-label={ariaLabel} width={w} height={h} className="chart chart-sparkline">
        <polyline points={points} fill="none" stroke={s ? seriesColor(s, 0) : "#2563eb"} strokeWidth={1.5} />
      </svg>
    );
  }

  const w = 560;
  const h = height ?? 220;
  const padL = padLeft ?? 48;
  const padR = 10;
  const padT = 12;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  if (!hasData) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${w} ${h}`}
        className="chart"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={0} y={0} width={w} height={h} fill="#f8fafc" rx={6} />
        <text x={w / 2} y={h / 2} textAnchor="middle" className="chart-empty-text">
          No data
        </text>
      </svg>
    );
  }

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const yFor = (v: number) => padT + plotH * (1 - v / max);
  const ticks = [0, max / 2, max];
  const labelStep = Math.max(1, Math.ceil(pointCount / 6));

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${w} ${h}`}
      className="chart"
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={yFor(t)} x2={w - padR} y2={yFor(t)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={padL - 6} y={yFor(t) + 3} textAnchor="end" className="chart-tick">
            {formatValue(Math.round(t))}
          </text>
        </g>
      ))}

      {variant === "bar" &&
        series.map((s, si) => {
          const groupW = plotW / pointCount;
          const barW = Math.max(2, (groupW * 0.7) / series.length);
          const groupPad = (groupW - barW * series.length) / 2;
          return s.values.map((v, i) => (
            <rect
              key={`${s.name}-${i}`}
              x={padL + i * groupW + groupPad + si * barW}
              y={yFor(v)}
              width={barW}
              height={Math.max(0, plotH - (yFor(v) - padT))}
              fill={seriesColor(s, si)}
              rx={1.5}
            />
          ));
        })}

      {variant === "line" &&
        series.map((s, si) => {
          const step = plotW / Math.max(1, s.values.length);
          const points = s.values
            .map((v, i) => `${(padL + (i + 0.5) * step).toFixed(1)},${yFor(v).toFixed(1)}`)
            .join(" ");
          return (
            <polyline
              key={s.name}
              points={points}
              fill="none"
              stroke={seriesColor(s, si)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

      {labels.map((label, i) =>
        i % labelStep === 0 ? (
          <text
            key={`${label}-${i}`}
            x={padL + (i + 0.5) * (plotW / pointCount)}
            y={h - 8}
            textAnchor="middle"
            className="chart-tick"
          >
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
