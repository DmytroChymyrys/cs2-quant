import { Check } from "lucide-react";
import { PublicShell } from "@/components/shell";
import { LinkButton, Notice, SemanticBadge } from "@/components/ui";
import { CheckoutButton } from "@/components/checkout-button";
import { publicPrices } from "@/lib/product/billing";
import {
  billingConfigured,
  billingSandboxEnabled,
} from "@/lib/product/billing-config";
import { money } from "@/lib/product/format";
import Decimal from "@/lib/product/decimal";
import {
  PLANNED_PRO_MONTHLY_USD,
  PREVIEW_COPY,
  previewAccessActive,
} from "@/lib/product/release";
import { pageMetadata } from "@/lib/seo";
import { TrackEvent } from "@/components/track-event";
export const metadata = pageMetadata({
  title: "Pricing — Free and Pro Plans",
  description: "Compare FloatAlpha Free and Pro. Both plans show the same observed market data; Pro adds advanced screening, condition alerts and longer collected history.",
  path: "/pricing",
});
export const dynamic = "force-dynamic";
export default async function Pricing() {
  const prices = await publicPrices();
  return (
    <PublicShell>
      <TrackEvent event={{ name: "pricing_viewed" }} eventKey="pricing" />
      <div className="pricing-fidelity">
        <section className="public-section">
          <div className="public-cta">
            <span className="eyebrow">Free / Pro</span>
            <h1>
              Market intelligence
              <br />
              <span className="cyan">without the noise.</span>
            </h1>
            <p className="muted">
              Free remains useful. Pro adds personal monitoring and advanced
              conditions.
              <br />
              Every plan sees the same market truth.
            </p>
            {previewAccessActive() && (
              <p className="muted">
                {PREVIEW_COPY.label} — Pro features are open to everyone while
                we continue expanding coverage. The price above is what Pro will
                cost once Preview ends.
              </p>
            )}
          </div>
          <div className="billing-periods">
            {previewAccessActive() ? (
              <>
                PREVIEW ACCESS <span> / NO PAYMENT REQUIRED</span>
              </>
            ) : (
              <>
                MONTHLY BILLING <span> / ANNUAL WHEN AVAILABLE</span>
              </>
            )}
          </div>
          <div className="pricing-grid" id="plans">
            <article className="panel price-card">
              <SemanticBadge state="FREE" />
              <h2>Free</h2>
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
              <h2>Pro</h2>
              {billingSandboxEnabled() && (
                <p className="eyebrow">BILLING SANDBOX · No real charges</p>
              )}
              {previewAccessActive() ? (
                /* Preview: the planned price is shown struck through so the
                   value being given away is legible, and no checkout is
                   rendered at all — there is nothing to click, not a disabled
                   button. */
                <div className="stack preview-offer">
                  <div className="price">
                    <s className="muted planned-price">
                      ${PLANNED_PRO_MONTHLY_USD}
                      <small style={{ fontSize: 12 }}> / month</small>
                    </s>
                  </div>
                  <div className="price cyan">{PREVIEW_COPY.offer}</div>
                  <p className="muted">{PREVIEW_COPY.summary}</p>
                  <p className="muted">{PREVIEW_COPY.invitation}</p>
                  <LinkButton href="/signup">Join the Preview</LinkButton>
                </div>
              ) : prices.length ? (
                prices.map((p) => (
                  <div key={p.id} className="stack">
                    <div className="price">
                      {money(new Decimal(p.amount).div(100).toString())}
                      <small style={{ fontSize: 12 }}> / {p.interval}</small>
                    </div>
                    <CheckoutButton
                      interval={p.interval === "year" ? "year" : "month"}
                      available={billingConfigured()}
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
          <div className="pricing-comparison">
            <div className="public-cta">
              <span className="eyebrow">Capability matrix</span>
              <h2>Comprehensive feature comparison</h2>
              <p className="muted">
                Actual capabilities. The same market truth on both plans.
              </p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Platform capability</th>
                  <th>Free</th>
                  <th>Pro</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["01 // Market intelligence", "", ""],
                  ["Market terminal", "Included", "Included"],
                  ["Asset intelligence", "Included", "Included"],
                  [
                    "Observed price, listing and sales facts",
                    "Included",
                    "Included",
                  ],
                  ["Calibrated Price Confidence", "UNAVAILABLE", "UNAVAILABLE"],
                  ["02 // Quantitative screening", "", ""],
                  ["Basic category and price filters", "Included", "Included"],
                  ["Advanced AND conditions", "—", "Included"],
                  ["Saved screens", "—", "Included"],
                  ["CSV export", "—", "Included"],
                  ["03 // History & monitoring", "", ""],
                  [
                    "Available observation history",
                    "Up to 7 days",
                    "Up to 30 days",
                  ],
                  ["Watchlist capacity", "20 assets", "100 assets"],
                  ["Manual portfolio holdings", "20 holdings", "100 holdings"],
                  ["Recorded cost-basis P&L", "Included", "Included"],
                  ["Since Last Visit checkpoints", "Included", "Included"],
                  ["04 // Condition alerts", "", ""],
                  ["False-to-true condition alerts", "—", "Included"],
                  ["In-app notifications", "—", "Included"],
                  ["Email alerts", "—", "When delivery is configured"],
                  ["05 // Transparency & limits", "", ""],
                  ["Source timestamps and provenance", "Included", "Included"],
                  [
                    "Uncollected history",
                    "Never fabricated",
                    "Never fabricated",
                  ],
                  [
                    "Validated confidence methodology",
                    "Not yet available",
                    "Not yet available",
                  ],
                ].map(([label, free, pro]) => (
                  <tr
                    key={label}
                    className={!free && !pro ? "matrix-group" : ""}
                  >
                    <td>{label}</td>
                    <td className={free === "Included" ? "positive" : ""}>
                      {free === "Included" ? "✓ INCLUDED" : free}
                    </td>
                    <td className={pro === "Included" ? "positive" : ""}>
                      {pro === "Included" ? "✓ INCLUDED" : pro}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="pricing-integrity panel">
            <span className="eyebrow">Pillars of integrity</span>
            <h2>Know what you’re paying for.</h2>
            <p>
              Capabilities unlock available observations and personal
              monitoring. They never create missing history or an unvalidated
              classification.
            </p>
            <div className="three-columns">
              {[
                [
                  "No buy / sell signals",
                  "Descriptive observations, not recommendations.",
                ],
                [
                  "Transparent methodology",
                  "Grounded source facts and explicit derived comparisons.",
                ],
                [
                  "Manage your subscription",
                  "Your subscription is managed through the Stripe billing portal.",
                ],
              ].map(([title, text]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="pricing-faq">
            <div className="public-cta">
              <span className="eyebrow">Transparency & mechanics</span>
              <h2>Frequently asked questions</h2>
            </div>
            {[
              [
                "Can I use FloatAlpha for free?",
                "Yes. Free includes the public terminal, asset intelligence, basic filters, and up to 20 watched assets and manual holdings.",
              ],
              [
                "What does Pro unlock?",
                "Advanced AND conditions, saved screens, CSV export, condition alerts, larger monitoring limits, and up to 30 days of available observations.",
              ],
              [
                "Does FloatAlpha provide investment advice?",
                "No. It presents observed prices, listing quantity, source sales aggregates and transparent comparisons.",
              ],
              [
                "Where does the data come from?",
                "The current pilot tracks 100 explicitly selected unversioned Skinport assets. Collection and source update timestamps remain separate.",
              ],
              [
                "What is Price Confidence?",
                "It describes support for an observed price, not its expected direction. A calibrated classification is not available yet.",
              ],
              [
                "Can I manage my subscription?",
                "Use Account & Billing to open the Stripe Customer Portal when billing is configured.",
              ],
            ].map(([question, answer]) => (
              <details key={question} open>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </section>
          <section className="pricing-final panel public-cta">
            <span className="eyebrow">Start with the market</span>
            <h2>Go deeper when you need to.</h2>
            <p>
              Explore grounded observations. Build your own monitoring workflow.
            </p>
            <div className="row">
              <LinkButton href="/signup">Start free</LinkButton>
              <LinkButton href="#plans" primary>
                Compare plans
              </LinkButton>
            </div>
          </section>
        </section>
      </div>
    </PublicShell>
  );
}
