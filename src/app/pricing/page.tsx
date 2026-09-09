import { Check } from "lucide-react";
import { PublicShell } from "@/components/shell";
import { LinkButton, Notice, SemanticBadge } from "@/components/ui";
import { CheckoutButton } from "@/components/checkout-button";
import { publicPrices } from "@/lib/product/billing";
import { money } from "@/lib/product/format";
import Decimal from "@/lib/product/decimal";
export const dynamic = "force-dynamic";
export default async function Pricing() {
  const prices = await publicPrices();
  return (
    <PublicShell>
      <section className="public-section">
        <div className="public-cta">
          <span className="eyebrow">Free / Pro</span>
          <h1>Choose your monitoring depth.</h1>
          <p className="muted">
            Free remains useful. Pro adds personal monitoring and advanced
            conditions.
            <br />
            Every plan sees the same market truth.
          </p>
        </div>
        <div className="pricing-grid">
          <article className="panel price-card">
            <SemanticBadge state="FREE" />
            <h2>Observe the market.</h2>
            <div className="price">
              $0<small style={{ fontSize: 12 }}> / month</small>
            </div>
            <ul>
              {[
                "Terminal and assets explorer",
                "Core asset intelligence",
                "Basic screener filters",
                "20 watchlist assets",
                "20 manual holdings",
                "Up to 7 days of collected history",
              ].map((x) => (
                <li key={x}>
                  <Check size={15} className="cyan" />
                  {x}
                </li>
              ))}
            </ul>
            <LinkButton primary href="/signup">
              Create a free account
            </LinkButton>
          </article>
          <article className="panel price-card pro">
            <SemanticBadge state="PRO" />
            <h2>Monitor with intent.</h2>
            {prices.length ? (
              prices.map((p) => (
                <div key={p.id} className="stack">
                  <div className="price">
                    {money(new Decimal(p.amount).div(100).toString())}
                    <small style={{ fontSize: 12 }}> / {p.interval}</small>
                  </div>
                  <CheckoutButton
                    interval={p.interval === "year" ? "year" : "month"}
                    available={Boolean(process.env.STRIPE_WEBHOOK_SECRET)}
                  />
                </div>
              ))
            ) : (
              <>
                <div className="price" style={{ fontSize: 23 }}>
                  Not available yet
                </div>
                <Notice>
                  Pro pricing and checkout will appear when billing is
                  configured.
                </Notice>
              </>
            )}
            <ul>
              {[
                "Advanced AND-condition screens and saved screens",
                "100 watchlist assets and manual holdings",
                "Condition alerts: in-app and configured email",
                "CSV export",
                "Up to 30 days of collected history",
              ].map((x) => (
                <li key={x}>
                  <Check size={15} className="cyan" />
                  {x}
                </li>
              ))}
            </ul>
          </article>
        </div>
        <div className="public-cta">
          <h2>Access never invents history.</h2>
          <p className="intro">
            A subscription unlocks available capabilities. Uncollected history,
            unvalidated confidence classifications, and unavailable metrics
            remain clearly labelled on every plan.
          </p>
        </div>
      </section>
    </PublicShell>
  );
}
