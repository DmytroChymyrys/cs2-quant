import { type HistoryPoint } from "@/lib/product/market";
import { timestamp } from "@/lib/product/format";
// Display scaling only: independent ranges keep unlike units from sharing a numerical axis.
export function LandingChart({
  points,
}: {
  points: (Omit<HistoryPoint, "quantity"> & { quantity: number | null })[];
}) {
  const first = Date.parse(points[0]?.at ?? ""),
    last = Date.parse(points.at(-1)?.at ?? "");
  const x = (i: number) =>
    4 + ((Date.parse(points[i].at) - first) / (last - first || 1)) * 392;
  const series = (key: "median" | "quantity" | "sales") => {
    const values = points.map((p) => (p[key] === null ? null : Number(p[key])));
    const valid = values.filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    const min = Math.min(...valid),
      max = Math.max(...valid);
    const y = (v: number) =>
      max === min ? 50 : 92 - ((v - min) / (max - min)) * 80;
    return {
      values,
      y,
      path: values
        .map((v, i) =>
          v === null || !Number.isFinite(v)
            ? ""
            : `${i === 0 || values[i - 1] === null ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`,
        )
        .join(" "),
    };
  };
  const price = series("median"),
    quantity = series("quantity"),
    sales = series("sales");
  const hasData = [price, quantity, sales].some(
    (s) => s.values.filter((v) => v !== null && Number.isFinite(v)).length >= 2,
  );
  const salesMaximum = Math.max(
    0,
    ...sales.values.filter(
      (v): v is number => v !== null && Number.isFinite(v),
    ),
  );
  const salesY = (v: number) =>
    salesMaximum === 0 ? 100 : 100 - (v / salesMaximum) * 90;
  const samples = points
    .map((_, i) => i)
    .filter((i) => i % Math.max(1, Math.ceil(points.length / 12)) === 0);
  return (
    <div className="lp-chart">
      <div className="lp-chart-legend">
        <span>
          <i /> Median <i /> Listings <i /> 24h sales aggregate
        </span>
        <span>Available 24h</span>
      </div>
      {!hasData ? (
        <div
          className="lp-chart-empty"
          aria-label="Collecting data. Decorative chart placeholder; no observations plotted."
        >
          <svg
            viewBox="0 0 400 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              d="M0 55 H400 M0 25 H400 M0 85 H400"
              stroke="#3d494d"
              strokeDasharray="2 5"
              fill="none"
            />
            <path
              d="M0 52 L55 50 L110 53 L165 49 L220 51 L275 50 L330 52 L400 50"
              stroke="#869398"
              strokeDasharray="3 4"
              fill="none"
            />
            <path
              d="M0 30 L80 38 L160 44 L240 58 L320 69 L400 80"
              stroke="#4cd6fb"
              strokeDasharray="3 4"
              fill="none"
            />
          </svg>
          <span>Collecting data · placeholder</span>
        </div>
      ) : (
        <svg
          viewBox="0 0 400 100"
          preserveAspectRatio="none"
          role="img"
          aria-label="Stored median, listing quantity and rolling sales aggregate observations, each scaled independently to its own range. Unchanged values remain flat."
        >
          {samples.map((i) =>
            sales.values[i] === null ? null : (
              <rect
                key={i}
                x={x(i) - 2}
                y={salesY(sales.values[i]!)}
                width="5"
                height={100 - salesY(sales.values[i]!)}
                fill="#4edea3"
                opacity=".6"
              />
            ),
          )}
          <path
            d={quantity.path}
            stroke="#4cd6fb"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            fill="none"
          />
          <path d={price.path} stroke="#e1e2eb" strokeWidth="1.5" fill="none" />
        </svg>
      )}
      <div className="lp-chart-axis">
        <span>{points.length ? timestamp(points[0].at) : "—"}</span>
        <span>{points.length ? timestamp(points.at(-1)!.at) : "—"}</span>
      </div>
      <span className="lp-chart-note">
        Independent visual scales · sampled source aggregates, not individual
        trades
      </span>
    </div>
  );
}
