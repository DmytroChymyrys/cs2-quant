import { marketSnapshot, categoryNames } from "@/lib/product/market";
import { money, integer, timestamp } from "@/lib/product/format";
import {
  Panel,
  PageHeading,
  SemanticBadge,
  DataState,
  LinkButton,
  ConfidenceBadge,
} from "@/components/ui";
import { MarketTable } from "@/components/market-table";
import { WatchButton } from "@/components/watch-button";
export default async function Assets({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const snapshot = await marketSnapshot();
  const assets = snapshot.assets.filter(
    (a) =>
      (!params.q || a.name.toLowerCase().includes(params.q.toLowerCase())) &&
      (!params.category || a.category === params.category),
  );
  const selected = assets.find((a) => a.id === params.selected) ?? assets[0];
  return (
    <>
      <PageHeading
        eyebrow="Asset directory"
        title="Assets explorer"
        description={`${snapshot.assets.length} tracked assets · Pilot universe · Skinport grounded`}
        action={<SemanticBadge state="GROUNDED" />}
      />
      {snapshot.error ? (
        <DataState state="SOURCE_UNAVAILABLE" />
      ) : (
        <div className="terminal-grid">
          <Panel title="Tracked universe" note={`${assets.length} RESULTS`}>
            <form className="filters" action="/assets">
              <input
                className="input"
                name="q"
                defaultValue={params.q}
                placeholder="Search market hash name…"
                aria-label="Search assets"
              />
              <select
                name="category"
                defaultValue={params.category ?? ""}
                aria-label="Category"
              >
                <option value="">All categories</option>
                {Object.entries(categoryNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="btn primary">Search</button>
              <LinkButton href="/assets">Reset</LinkButton>
            </form>
            {snapshot.assets.length ? (
              <MarketTable assets={assets} />
            ) : (
              <DataState state="UNAVAILABLE" title="No tracked data" />
            )}
          </Panel>
          <aside className="rail stack">
            {selected ? (
              <Panel title="Asset inspection">
                <div className="pad stack">
                  <SemanticBadge state={selected.state} />
                  <h2 className="asset-name">{selected.name}</h2>
                  <p>{categoryNames[selected.category ?? ""]}</p>
                </div>
                <dl>
                  <dt>Observed median</dt>
                  <dd>{money(selected.median)}</dd>
                  <dt>Observed minimum</dt>
                  <dd>{money(selected.minimum)}</dd>
                  <dt>Listing quantity</dt>
                  <dd>{integer(selected.quantity)}</dd>
                  <dt>24h sales activity</dt>
                  <dd>{integer(selected.sales24h)}</dd>
                  <dt>7d sales activity</dt>
                  <dd>{integer(selected.sales7d)}</dd>
                  <dt>Price confidence</dt>
                  <dd>
                    <ConfidenceBadge />
                  </dd>
                </dl>
                <div className="pad stack">
                  <p>
                    Observed: {timestamp(selected.observedAt)}
                    <br />
                    Source update: {timestamp(selected.sourceUpdatedAt)}
                  </p>
                  <LinkButton href={`/asset/${selected.id}`} primary>
                    Open asset intelligence →
                  </LinkButton>
                  <WatchButton assetId={selected.id} />
                </div>
              </Panel>
            ) : (
              <Panel title="Inspection rail">
                <DataState state="NO_RESULTS" title="Select an asset" />
              </Panel>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
