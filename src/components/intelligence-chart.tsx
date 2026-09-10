"use client";
import { useId, useState } from "react";
import type { MarketSeriesPoint } from "@/lib/product/intelligence/contract";
import { DataState } from "./ui";
import { timestamp } from "@/lib/product/format";
export type ChartMetric =
  | "minimum"
  | "median"
  | "listings"
  | "activity"
  | "volatility"
  | "sourceAgeSeconds";
export function seriesPath(points: MarketSeriesPoint[], metric: ChartMetric) {
  const values = points.map((p) =>
    p[metric] === null ? null : Number(p[metric]),
  );
  const valid = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (!valid.length) return null;
  const min = Math.min(...valid),
    max = Math.max(...valid),
    range = max - min || Math.max(Math.abs(max) * 0.02, 1);
  const first = Date.parse(points[0].at),
    last = Date.parse(points.at(-1)!.at);
  return {
    min,
    max,
    range,
    path: values
      .map((v, i) =>
        v === null || !Number.isFinite(v)
          ? ""
          : `${i === 0 || values[i - 1] === null || Date.parse(points[i].window) - Date.parse(points[i - 1].window) !== 300000 ? "M" : "L"}${(20 + ((Date.parse(points[i].at) - first) / (last - first || 1)) * 960).toFixed(2)},${(210 - ((v - min) / range) * 170).toFixed(2)}`,
      )
      .join(" "),
  };
}
export function IntelligenceChart({
  points,
  synthetic = false,
  compact = false,
}: {
  points: MarketSeriesPoint[];
  synthetic?: boolean;
  compact?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [metric, setMetric] = useState<ChartMetric>("minimum"),
    id = useId();
  const labels: Record<ChartMetric, string> = {
    minimum: "MINIMUM LISTING PRICE",
    median: synthetic ? "SIMULATED MEDIAN" : "OBSERVED MEDIAN",
    listings: "LISTING QUANTITY",
    activity: "ACTIVITY · 1H",
    volatility: "VOLATILITY · 1H",
    sourceAgeSeconds: "ITEMS AGE AT OBSERVATION",
  };
  const graph = points.length >= 2 ? seriesPath(points, metric) : null;
  const active = activeIndex === null ? null : points[activeIndex];
  const activeValue = active?.[metric] ?? null;
  const activeX = active
    ? 20 +
      ((Date.parse(active.at) - Date.parse(points[0].at)) /
        (Date.parse(points.at(-1)!.at) - Date.parse(points[0].at) || 1)) *
        960
    : null;
  const formatted = (v: string | number | null) =>
    v === null
      ? "Unavailable"
      : Number(v).toLocaleString("en-US", {
          minimumFractionDigits:
            metric === "listings" || metric === "sourceAgeSeconds" ? 0 : 2,
          maximumFractionDigits:
            metric === "listings" || metric === "sourceAgeSeconds" ? 0 : 2,
        });
  return (
    <>
      <div className="chart-controls">
        <div className="tabs" aria-label="Chart metric">
          {Object.entries(labels).map(([k, v]) => (
            <button
              key={k}
              aria-pressed={metric === k}
              className={metric === k ? "active" : ""}
              onClick={() => {
                setMetric(k as ChartMetric);
                setActiveIndex(null);
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {!graph ? (
        <DataState
          state="INSUFFICIENT_HISTORY"
          title="Unavailable — insufficient observation history"
          description={
            metric === "volatility"
              ? "1h volatility requires 13 consecutive observations with positive minimum listing prices."
              : "At least two eligible points are needed. Missing values are not replaced by zero."
          }
        />
      ) : (
        <div className="chart intelligence-plot">
          <div className="chart-labels">
            <span>{labels[metric]}</span>
            <span>
              {formatted(graph.min)} — {formatted(graph.max)}
            </span>
          </div>
          <svg
            viewBox="0 0 1000 240"
            role="img"
            aria-labelledby={id}
            aria-describedby={`${id}-instructions`}
            tabIndex={0}
            onPointerMove={(event) => {
              const matrix = event.currentTarget.getScreenCTM();
              if (!matrix) return;
              const x = new DOMPoint(
                event.clientX,
                event.clientY,
              ).matrixTransform(matrix.inverse()).x;
              const time =
                Date.parse(points[0].at) +
                Math.max(0, Math.min(1, (x - 20) / 960)) *
                  (Date.parse(points.at(-1)!.at) - Date.parse(points[0].at));
              setActiveIndex(nearestObservation(points, time));
            }}
            onPointerLeave={(event) => {
              if (document.activeElement !== event.currentTarget)
                setActiveIndex(null);
            }}
            onFocus={() => setActiveIndex(points.length - 1)}
            onBlur={() => setActiveIndex(null)}
            onKeyDown={(event) => {
              const index = activeIndex ?? points.length - 1;
              const next =
                event.key === "ArrowLeft"
                  ? Math.max(0, index - 1)
                  : event.key === "ArrowRight"
                    ? Math.min(points.length - 1, index + 1)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? points.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setActiveIndex(next);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setActiveIndex(null);
              }
            }}
          >
            <title
              id={id}
            >{`${labels[metric]} over ${synthetic ? "synthetic demo" : "observed"} time`}</title>
            <desc id={`${id}-instructions`}>
              Use Left and Right arrows to inspect recorded points; Home and End
              jump to the endpoints. Escape dismisses the readout. Values are
              not interpolated.
            </desc>
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00b4d8" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#00b4d8" stopOpacity="0" />
              </linearGradient>
            </defs>
            {graph.path
              .split(/(?=M)/)
              .filter((s) => s.trim())
              .map((segment, i) => {
                const coords = [...segment.matchAll(/[ML]([\d.]+),([\d.]+)/g)];
                return coords.length > 1 ? (
                  <path
                    key={i}
                    d={`${segment} L${coords.at(-1)![1]},220 L${coords[0][1]},220 Z`}
                    fill={`url(#${id}-fill)`}
                  />
                ) : null;
              })}
            {[40, 80, 120, 160, 200].map((y) => (
              <line
                key={y}
                x1="20"
                x2="980"
                y1={y}
                y2={y}
                stroke="#263145"
                strokeOpacity={y === 120 ? 0.85 : 0.45}
                strokeDasharray={y === 120 ? undefined : "2 5"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {graph.min <= 0 && graph.max >= 0 && (
              <line
                x1="20"
                x2="980"
                y1={210 - ((0 - graph.min) / graph.range) * 170}
                y2={210 - ((0 - graph.min) / graph.range) * 170}
                stroke="#64748b"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={graph.path}
              fill="none"
              stroke="#00b4d8"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {activeX !== null && (
              <g className="chart-crosshair" pointerEvents="none">
                <line
                  x1={activeX}
                  x2={activeX}
                  y1="28"
                  y2="220"
                  stroke="#94a3b8"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
                {activeValue !== null &&
                  Number.isFinite(Number(activeValue)) && (
                    <circle
                      cx={activeX}
                      cy={
                        210 -
                        ((Number(activeValue) - graph.min) / graph.range) * 170
                      }
                      r="3"
                      fill="#0e121a"
                      stroke="#38bdf8"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
              </g>
            )}
          </svg>
          {active && (
            <div
              className="chart-readout"
              style={{
                left: activeX! > 500 ? 12 : undefined,
                right: activeX! <= 500 ? 12 : undefined,
              }}
              role="status"
            >
              <span>{timestamp(active.at)}</span>
              <strong>
                {formatted(activeValue)}
                {activeValue !== null
                  ? metric === "minimum" || metric === "median"
                    ? " USD"
                    : metric === "volatility"
                      ? "%"
                      : metric === "sourceAgeSeconds"
                        ? "s"
                        : ""
                  : ""}
              </strong>
              <small>
                {labels[metric]} ·{" "}
                {synthetic
                  ? "SYNTHETIC"
                  : metric === "activity" ||
                      metric === "volatility" ||
                      metric === "sourceAgeSeconds"
                    ? "DERIVED"
                    : "OBSERVED"}
              </small>
            </div>
          )}
          <div className="chart-labels">
            <span>{timestamp(points[0]?.at)}</span>
            <span>{timestamp(points.at(-1)?.at)}</span>
          </div>
        </div>
      )}
      {!compact && (
        <details className="chart-caption">
          <summary>Observation data and methodology</summary>
          {synthetic && (
            <p>
              DEMO / SYNTHETIC observations. Not collected market prices or
              research evidence.
            </p>
          )}
          <p>
            Listing references are not execution prices. Gaps and null values
            break the line. Activity and volatility use their complete 1h
            windows from the underlying snapshot; the display horizon clips
            timestamps and never requests extra points. No sales-volume series
            is interpolated between History versions.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="number">Observation · UTC</th>
                  <th className="number">{labels[metric]}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.at}>
                    <td className="number">{timestamp(p.at)}</td>
                    <td className="number">
                      {p[metric] === null ? "Unavailable" : String(p[metric])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

// Select an actual observation, including nulls, rather than inventing a value in a gap.
export function nearestObservation(
  points: Pick<MarketSeriesPoint, "at">[],
  time: number,
) {
  let low = 0,
    high = points.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Date.parse(points[middle].at) < time) low = middle + 1;
    else high = middle;
  }
  return low > 0 &&
    Math.abs(Date.parse(points[low - 1].at) - time) <=
      Math.abs(Date.parse(points[low].at) - time)
    ? low - 1
    : low;
}
