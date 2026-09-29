import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/ops/auth";
import { readOps, type OpsTable } from "@/lib/ops/data";
import { readFounderOverview } from "@/lib/ops/founder";
import { FounderOverviewView } from "@/components/founder-overview";
import { OPS_PATH, OPS_SECTIONS, OPS_ACTIVATION } from "@/lib/ops/config";
import { opsInput, opsSection } from "@/lib/ops/input";
import { ProductError } from "@/lib/product/api";
import "../ops.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "FloatAlpha Ops",
  robots: { index: false, follow: false },
};
function display(value: unknown) {
  if (value === null || value === undefined) return "UNAVAILABLE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
function Table({
  table,
  paginate = false,
}: {
  table: OpsTable;
  paginate?: boolean;
}) {
  const rows = paginate ? table.rows.slice(0, 25) : table.rows;
  return (
    <section className="ops-panel">
      <h2>
        {table.title}
        <small>{table.durationMs} ms</small>
      </h2>
      {table.unavailable ? (
        <p role="status">UNAVAILABLE · Could not read this data source.</p>
      ) : rows.length === 0 ? (
        <p>No records in this scope.</p>
      ) : (
        <div className="ops-scroll">
          <table>
            <thead>
              <tr>
                {Object.keys(rows[0]).map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {Object.entries(row).map(([key, value]) => (
                    <td key={key}>{display(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export default async function OpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof ProductError && error.status === 401)
      redirect("/login");
    if (error instanceof ProductError && error.status === 403) forbidden();
    // Fail closed for outages and rate limits. API retains precise 429/503 statuses.
    throw error;
  }
  const path = (await params).section ?? [];
  const section = path.length <= 1 ? opsSection(path[0]) : null;
  if (!section) notFound();
  const raw = await searchParams;
  const input = opsInput(
    new URLSearchParams(
      Object.entries(raw).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    ),
  );
  const tables = await readOps(section, input.days, input.search, input.page);
  // Only the overview needs it, and it reads several sources; do not pay for
  // it on the table-driven sections.
  const overview =
    section === "overview" ? await readFounderOverview(input.days) : null;
  const url = (page: number) =>
    `${OPS_PATH}/users?${new URLSearchParams({ days: String(input.days), q: input.search, page: String(page) })}`;
  return (
    <main className="ops">
      <header>
        <Link href={OPS_PATH}>
          FloatAlpha <strong>Ops</strong>
        </Link>
        <span>Internal · Read only · UTC</span>
      </header>
      <nav aria-label="Operations">
        {OPS_SECTIONS.map((item) => (
          <Link
            key={item}
            aria-current={section === item ? "page" : undefined}
            href={item === "overview" ? OPS_PATH : `${OPS_PATH}/${item}`}
          >
            {item}
          </Link>
        ))}
      </nav>
      <h1>{section}</h1>
      <p className="ops-muted">
        As of {new Date().toISOString()} · Values reflect persisted application
        data.
      </p>
      <form method="get" className="ops-filters">
        <label>
          Window{" "}
          <select name="days" defaultValue={input.days}>
            <option value="1">Today (UTC)</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        {section === "users" && (
          <label>
            Search users{" "}
            <input
              name="q"
              maxLength={100}
              defaultValue={input.search}
              placeholder="Email or application user ID"
            />
          </label>
        )}
        <button type="submit" className="btn">
          Apply
        </button>
      </form>
      {/* Overview is served by the founder panels below; its legacy table
          repeated the same counts in a second, worse form. */}
      {section !== "overview" &&
        tables.map((table) => (
          <Table
            key={table.title}
            table={table}
            paginate={section === "users"}
          />
        ))}
      {section === "users" && (
        <div className="ops-filters">
          {input.page > 1 && <Link href={url(input.page - 1)}>Previous</Link>}
          <span>Page {input.page} · 25 users per page</span>
          {tables[0].rows.length > 25 && input.page < 400 && (
            <Link href={url(input.page + 1)}>Next</Link>
          )}
        </div>
      )}
      {section === "overview" && overview && (
        <>
          <FounderOverviewView data={overview} />
          <section className="ops-panel">
            <h2>Metric definitions</h2>
            <p>{OPS_ACTIVATION}</p>
            <p>
              Signup = auth account creation within the window. Activated = a
              user who has watched an asset, recorded a holding, configured an
              alert, or saved a screen. Returning = a session created at least a
              day after that account was created. Each is counted from persisted
              rows.
            </p>
            <p>
              Visitors, asset views and screener query counts exist only in GA4,
              which is written from the browser. The server holds no Data API
              credential, so they are reported Unavailable rather than
              approximated.
            </p>
            <p>
              The provider universe and the derived intelligence scope are
              separate: one observes the full Skinport catalogue as change
              history, the other computes listing-features-v3 over the tracked
              universe. Free/Pro breakdown is in Billing.
            </p>
          </section>
        </>
      )}
      {section === "product" && (
        <p className="ops-muted">
          Most viewed assets, screener filters, history ranges, and return
          visits: UNAVAILABLE. Current totals are snapshots; only alert triggers
          have retained event history.
        </p>
      )}
      {section === "system" && (
        <p className="ops-muted">
          Catalog sync timestamp is the last committed successful sync; failed
          sync attempts and general application error history are UNAVAILABLE.
          Collector error codes are shown without raw payloads. Image health
          refresh runs independently through the existing protected health
          endpoint.
        </p>
      )}
      {section === "billing" && (
        <p className="ops-muted">
          Pro = active/trialing subscription with a configured Pro price and a
          future period end; all other registered users are Free. This is the
          current Stripe-backed application mirror. No Stripe API calls.
          Checkout/start/cancellation event history: UNAVAILABLE.
        </p>
      )}
    </main>
  );
}
