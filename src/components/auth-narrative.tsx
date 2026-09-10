import { ShieldCheck, LockKeyhole } from "lucide-react";
import { marketSnapshot } from "@/lib/product/market";
import { money, integer, percent } from "@/lib/product/format";

export async function AuthNarrative({
  mode,
}: {
  mode: "login" | "signup" | "recovery";
}) {
  const snapshot = mode === "login" ? await marketSnapshot() : null;
  const asset = snapshot?.assets[0];
  return (
    <section className="auth-narrative">
      <span className="narrative-label">
        <span className="dot" />
        {mode === "login"
          ? "QUANTITATIVE MARKET SURVEILLANCE"
          : mode === "signup"
            ? "INSTITUTIONAL IDENTITY & ANALYTICS"
            : "ACCOUNT SECURITY & RECOVERY"}
      </span>
      <h2>
        {mode === "login" ? (
          <>
            See what price alone
            <br />
            <span>doesn’t show.</span>
          </>
        ) : mode === "signup" ? (
          <>
            Analytics grounded in observations,
            <br />
            <span>not marketplace noise.</span>
          </>
        ) : (
          <>
            Secure credential recovery
            <br />
            <span>without exposure.</span>
          </>
        )}
      </h2>
      <p>
        {mode === "login"
          ? "Observe price, listing supply and sales activity together. Investigate changing conditions with their source evidence in view."
          : mode === "signup"
            ? "Create a free FloatAlpha account to access your watchlist, manual holdings and grounded asset intelligence."
            : "Request a password reset link for your account. Recovery responses do not disclose whether an email address is registered."}
      </p>
      {mode === "login" ? (
        <div className="narrative-example auth-thesis">
          <div className="auth-thesis-head">
            <div>
              <strong>{asset?.name ?? "MARKET OBSERVATIONS"}</strong>
              <small>Three-vector market observations · Skinport</small>
            </div>
            <span className="auth-thesis-badge">CONFIDENCE: COLLECTING</span>
          </div>
          <div className="auth-thesis-metrics">
            <div>
              <span>PRICE Δ</span>
              <b>
                {asset?.priceChange != null
                  ? percent(asset.priceChange)
                  : "−1.2%"}
              </b>
              <small>
                {asset?.priceChange != null
                  ? `Median: ${money(asset.median)}`
                  : "Collecting data · sample"}
              </small>
            </div>
            <div>
              <span>LISTINGS</span>
              <b className="cyan">{integer(asset?.quantity ?? null)}</b>
              <small>Published availability</small>
            </div>
            <div>
              <span>SALES ACT.</span>
              <b className="positive">{integer(asset?.sales24h ?? null)}</b>
              <small>Transactions / 24h</small>
            </div>
          </div>
          <div className="auth-thesis-chips">
            <span>SUPPLY OBSERVATIONS</span>
            <span>SALES ACTIVITY</span>
          </div>
          <p>“Price barely moved. The market underneath it did.”</p>
        </div>
      ) : mode === "signup" ? (
        <>
          <div className="narrative-dimensions">
            {[
              [
                "01 // PRICE",
                "Observed prices",
                "Inspect the median, minimum and available history.",
              ],
              [
                "02 // SUPPLY",
                "Listing quantity",
                "Understand availability across collected snapshots.",
              ],
              [
                "03 // ACTIVITY",
                "Sales aggregates",
                "Read the source-published sales windows.",
              ],
            ].map(([label, title, desc]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{title}</strong>
                <p>{desc}</p>
              </article>
            ))}
          </div>
          <div className="narrative-example">
            <strong>
              <span className="dot" /> SKINPORT GROUNDED OBSERVATIONS
            </strong>
            <p>
              No synthetic sentiment, directional recommendations or fabricated
              history.
            </p>
          </div>
        </>
      ) : (
        <div className="narrative-example">
          <strong>
            <LockKeyhole size={16} /> RECOVERY PROTOCOL
          </strong>
          <ul>
            <li>Time-limited reset links</li>
            <li>Single-use recovery tokens</li>
            <li>Generic responses protect account lookup</li>
          </ul>
        </div>
      )}
      <div className="narrative-foot">
        <ShieldCheck size={16} />
        <span>No Steam credentials or inventory connection required.</span>
      </div>
    </section>
  );
}
