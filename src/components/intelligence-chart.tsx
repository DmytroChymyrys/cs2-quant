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
  return (
    <>
      <div className="chart-controls">
        <div className="tabs" aria-label="Chart metric">
          {Object.entries(labels).map(([k, v]) => (
            <button
              key={k}
              aria-pressed={metric === k}
              className={metric === k ? "active" : ""}
              onClick={() => setMetric(k as ChartMetric)}
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
        <div className="chart">
          <div className="chart-labels">
            <span>{labels[metric]}</span>
            <span>
              {graph.min.toFixed(2)} — {graph.max.toFixed(2)}
            </span>
          </div>
          <svg viewBox="0 0 1000 240" role="img" aria-labelledby={id}>
            <title
              id={id}
            >{`${labels[metric]} over ${synthetic ? "synthetic demo" : "observed"} time`}</title>
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
                strokeDasharray="3 4"
              />
            ))}
            <path
              d={graph.path}
              fill="none"
              stroke="#00b4d8"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
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
                  <th>Observation · UTC</th>
                  <th>{labels[metric]}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.at}>
                    <td>{timestamp(p.at)}</td>
                    <td>
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
