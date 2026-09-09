import { currentUser } from "@/lib/product/auth";
import { entitlements } from "@/lib/product/entitlements";
import { AdvancedScreener } from "@/components/advanced-screener";
import Decimal from "@/lib/product/decimal";
import { marketSnapshot, categoryNames } from "@/lib/product/market";
import {
  Panel,
  PageHeading,
  DataState,
  LinkButton,
  Notice,
} from "@/components/ui";
import { MarketTable } from "@/components/market-table";
export default async function Screener({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams;
  const user = await currentUser();
  const caps = user ? await entitlements(user.app.id) : null;
  const snapshot = await marketSnapshot();
  const numeric = (v: string | undefined) =>
    v && /^\d+(\.\d{1,8})?$/.test(v) ? new Decimal(v) : null;
  const minimum = numeric(p.min),
    maximum = numeric(p.max);
  const assets = snapshot.assets.filter(
    (a) =>
      (!p.category || a.category === p.category) &&
      (!minimum || (a.median !== null && new Decimal(a.median).gte(minimum))) &&
      (!maximum || (a.median !== null && new Decimal(a.median).lte(maximum))) &&
      (!p.state || a.state === p.state),
  );
  return (
    <>
      <PageHeading
        eyebrow="Quantitative discovery"
        title="Screener"
        description="Filter grounded observations. History-dependent metrics remain unavailable until their baselines exist."
      />
      <div className="terminal-grid">
        <Panel title="Screen conditions" note="BASIC FILTERS">
          <form className="filters">
            <label>
              Category
              <select name="category" defaultValue={p.category ?? ""}>
                <option value="">All categories</option>
                {Object.entries(categoryNames).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minimum median · USD
              <input
                className="input"
                name="min"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,8})?"
                defaultValue={p.min}
                placeholder="0.00"
              />
            </label>
            <label>
              Maximum median · USD
              <input
                className="input"
                name="max"
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,8})?"
                defaultValue={p.max}
                placeholder="No maximum"
              />
            </label>
            <label>
              Data state
              <select name="state" defaultValue={p.state ?? ""}>
                <option value="">All states</option>
                <option>GROUNDED</option>
                <option>STALE</option>
                <option>UNAVAILABLE</option>
              </select>
            </label>
            <button className="btn primary">Run screen</button>
            <LinkButton href="/screener">Clear</LinkButton>
          </form>
          {snapshot.error ? (
            <DataState state="SOURCE_UNAVAILABLE" />
          ) : (
            <MarketTable assets={assets} />
          )}
          <div className="chart-caption">
            {assets.length} results. Null prices never match numerical
            thresholds. Values are compared using exact decimals.
          </div>
        </Panel>
        <aside className="stack">
          <Panel title="Advanced condition builder">
            {caps?.canUseAdvancedScreener ? (
              <AdvancedScreener />
            ) : (
              <DataState
                state="PRO_LOCKED"
                title="Advanced screens"
                description="Sign in to check your capabilities. Extended history never unlocks data that has not been collected."
                action={
                  <LinkButton href="/settings">
                    View account & capabilities
                  </LinkButton>
                }
              />
            )}
          </Panel>
          <Notice>
            Price Confidence filters remain unavailable until a classification
            methodology is validated.
          </Notice>
        </aside>
      </div>
    </>
  );
}
