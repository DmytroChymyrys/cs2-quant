"use client";
import { useState } from "react";
import { type HistoryPoint } from "@/lib/product/market";
import { DataState } from "./ui";
import { money, integer, timestamp } from "@/lib/product/format";
export function ObservationChart({ points }: { points: HistoryPoint[] }) {
  const [metric, setMetric] = useState<"median" | "quantity" | "sales">(
    "median",
  );
  if (points.length < 2)
    return (
      <DataState
        state="INSUFFICIENT_HISTORY"
        title="Collecting observation history"
        description="At least two valid observations are needed to draw a series. No synthetic history is shown."
      />
    );
  const values = points.map((p) =>
    p[metric] === null ? null : Number(p[metric]),
  );
  const valid = values.filter((v): v is number => v !== null);
  if (!valid.length) return <DataState state="UNAVAILABLE" />;
  const minimum = Math.min(...valid),
    maximum = Math.max(...valid),
    range = maximum - minimum || Math.max(Math.abs(maximum) * 0.02, 1);
  const first = Date.parse(points[0].at),
    last = Date.parse(points.at(-1)!.at);
  const x = (i: number) =>
    ((Date.parse(points[i].at) - first) / (last - first || 1)) * 960 + 20;
  const y = (v: number) => 210 - ((v - minimum) / range) * 170;
  const path = values
    .map((v, i) => {
      if (v === null) return "";
      const command = i === 0 || values[i - 1] === null ? "M" : "L";
      return `${command}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
    })
    .join(" ");
  return (
    <>
      <div className="chart-controls">
        <div className="tabs" aria-label="Chart metric">
          {(["median", "quantity", "sales"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={key === metric ? "active" : ""}
              aria-pressed={key === metric}
            >
              {key === "median"
                ? "OBSERVED MEDIAN"
                : key === "quantity"
                  ? "LISTING QUANTITY"
                  : "24H SALES AGGREGATE"}
            </button>
          ))}
        </div>
      </div>
      <div className="chart">
        <div className="chart-labels">
          <span>
            {metric === "median" ? money(String(maximum)) : integer(maximum)}
          </span>
          <span>{points.length} OBSERVATIONS · UTC</span>
        </div>
        <svg
          viewBox="0 0 1000 245"
          role="img"
          aria-label={`${metric} from ${timestamp(points[0].at)} to ${timestamp(points.at(-1)!.at)}. Minimum ${minimum}, maximum ${maximum}.`}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#00b4d8" stopOpacity=".16" />
              <stop offset="1" stopColor="#00b4d8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[40, 85, 130, 175, 220].map((n) => (
            <line
              key={n}
              x1="20"
              y1={n}
              x2="980"
              y2={n}
              stroke="#263145"
              strokeDasharray="3 4"
            />
          ))}
          {[20, 210, 400, 590, 780, 980].map((n) => (
            <line key={n} x1={n} y1="20" x2={n} y2="220" stroke="#1b2230" />
          ))}
          <path
            d={path}
            fill="none"
            stroke="#00b4d8"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {valid.length === points.length && (
            <path d={`${path} L980,220 L20,220 Z`} fill="url(#chart-fill)" />
          )}
        </svg>
        <div className="chart-labels">
          <span>{timestamp(points[0].at)}</span>
          <span>{timestamp(points.at(-1)!.at)}</span>
        </div>
      </div>
      <details className="chart-caption">
        <summary>Observation data and methodology</summary>
        <p>
          Each point is a stored Skinport observation. Sales values are
          source-published rolling aggregates, not individual sales. The chart
          shows only available observations; selected history windows are not
          backfilled.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Observed at</th>
                <th className="number">Median</th>
                <th className="number">Listings</th>
                <th className="number">24h sales</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.at}>
                  <td>{timestamp(p.at)}</td>
                  <td className="number">{money(p.median)}</td>
                  <td className="number">{integer(p.quantity)}</td>
                  <td className="number">{integer(p.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
