import Link from "next/link";
import { DeleteAccount } from "@/components/delete-account";
import { currentUser } from "@/lib/product/auth";
import { entitlements } from "@/lib/product/entitlements";
import { timestamp } from "@/lib/product/format";
import { AuthRequired } from "@/components/auth-required";
import {
  PageHeading,
  Panel,
  SemanticBadge,
  LinkButton,
  Notice,
} from "@/components/ui";
import { PreferencesForm } from "@/components/preferences-form";
import { MutationButton, SignOut } from "@/components/product-actions";
import { billingAccount } from "@/lib/product/billing-account";
import { billingSandboxEnabled } from "@/lib/product/billing-config";
import { BillingReturn } from "@/components/billing-return";
import { PRIVATE_ROBOTS } from "@/lib/seo";
export const metadata = {
  title: "Settings",
  description: "Account and billing settings.",
  robots: PRIVATE_ROBOTS,
};
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="account" />;
  const caps = await entitlements(user.app.id);
  const billing = await billingAccount(user.app.id);
  const { checkout } = await searchParams;
  return (
    <div className="personal-workstation account-workstation">
      <PageHeading
        eyebrow="Account & billing"
        title="Account & settings"
        description="Identity, monitoring preferences, subscription, and sessions."
        action={<SignOut />}
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Account sections">
          <a href="#identity">
            Account <span>01</span>
          </a>
          <a href="#preferences">
            Preferences <span>02</span>
          </a>
          <a href="#billing">
            Subscription <span>03</span>
          </a>
          <a href="#security">
            Security <span>04</span>
          </a>
          <a href="#danger">
            Danger zone <span>!</span>
          </a>
          <div className="account-governance">
            <span className="eyebrow">Data governance</span>
            <p>
              Monitoring preferences personalize your workspace. They never
              alter the shared market observations.
            </p>
            <Link href="/#data">Data methodology →</Link>
            <Link href="/assets">Skinport pilot universe →</Link>
          </div>
        </nav>
        <div className="stack">
          <div id="identity">
            <Panel title="01 Account identity">
              <div className="pad account-identity">
                <div className="account-fact">
                  <span className="eyebrow">Primary email address</span>
                  <div className="row">
                    <span className="mono">{user.identity.email}</span>
                    <SemanticBadge
                      state={
                        user.identity.emailVerified ? "VERIFIED" : "UNVERIFIED"
                      }
                    />
                  </div>
                </div>
                <div className="account-fact">
                  <span className="eyebrow">Display name</span>
                  <strong>{user.identity.name}</strong>
                </div>
                <div className="account-fact">
                  <span className="eyebrow">Account created</span>
                  <span className="mono">
                    {timestamp(new Date(user.identity.createdAt).toISOString())}
                  </span>
                </div>
                <div className="account-fact">
                  <span className="eyebrow">Entitlement class</span>
                  <strong className="cyan">{caps.plan}</strong>
                  <span className="muted">Current workspace access</span>
                </div>
              </div>
            </Panel>
          </div>
          <div id="preferences">
            <Panel title="02 Market & monitoring preferences">
              <div className="pad">
                {billingSandboxEnabled() ? (
                  <Notice>
                    Market monitoring remains demonstration-only in this billing
                    sandbox.
                  </Notice>
                ) : (
                  <PreferencesForm
                    initialCategories={user.app.categories}
                    initialInterests={user.app.interests}
                  />
                )}
              </div>
            </Panel>
          </div>
          <div id="billing">
            <Panel title="03 Subscription & billing">
              <div className="pad stack">
                {billingSandboxEnabled() && (
                  <span className="eyebrow">
                    BILLING SANDBOX · No real charges
                  </span>
                )}
                <BillingReturn checkout={checkout} plan={caps.plan} />
                <div className="account-fact">
                  <span className="eyebrow">Current plan</span>
                  <h2>FloatAlpha {caps.plan}</h2>
                </div>
                <div className="account-fact">
                  <span className="eyebrow">Subscription status</span>
                  <strong className="mono">
                    {billing.status === "none"
                      ? "NO SUBSCRIPTION"
                      : billing.status.replaceAll("_", " ").toUpperCase()}
                  </strong>
                </div>
                {billing.currentPeriodEnd && (
                  <div className="account-fact">
                    <span className="eyebrow">
                      {billing.cancelAtPeriodEnd
                        ? "Access ends"
                        : billing.status === "active"
                          ? "Next renewal"
                          : "Current period end"}
                    </span>
                    <span className="mono">
                      {timestamp(billing.currentPeriodEnd)}
                    </span>
                    {billing.cancelAtPeriodEnd && caps.plan === "Pro" && (
                      <span className="muted">
                        Cancellation scheduled. Access continues until the
                        current period ends.
                      </span>
                    )}
                  </div>
                )}
                <p>
                  Watchlist: up to {caps.maxWatchlistAssets} assets · Holdings:{" "}
                  {caps.maxHoldings} · History: up to {caps.historyWindowDays}{" "}
                  days when available.
                </p>
                <p className="muted">
                  Paid features never create missing history. Card and
                  subscription management is handled by Stripe.
                </p>
                <div className="row">
                  {billing.canManage && (
                    <MutationButton
                      label="Manage billing"
                      endpoint="/api/product/billing/portal"
                    />
                  )}
                  <LinkButton href="/pricing">Compare plans</LinkButton>
                </div>
                <table className="market-table account-capabilities">
                  <thead>
                    <tr>
                      <th>Workspace capability</th>
                      <th>Current entitlement</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Watchlist capacity</td>
                      <td>{caps.maxWatchlistAssets} assets</td>
                    </tr>
                    <tr>
                      <td>Portfolio holdings</td>
                      <td>{caps.maxHoldings} holdings</td>
                    </tr>
                    <tr>
                      <td>Historical observation depth</td>
                      <td>
                        Up to {caps.historyWindowDays} days when available
                      </td>
                    </tr>
                    <tr>
                      <td>Market source</td>
                      <td>Skinport · 100-asset pilot universe</td>
                    </tr>
                    <tr>
                      <td>Confidence classification</td>
                      <td>
                        <SemanticBadge state="UNAVAILABLE" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
          <div id="security">
            <Panel title="04 Security & sessions">
              <div className="pad stack">
                <p>
                  Created:{" "}
                  <span className="mono">
                    {timestamp(new Date(user.session.createdAt).toISOString())}
                  </span>
                </p>
                <p>
                  Expires:{" "}
                  <span className="mono">
                    {timestamp(new Date(user.session.expiresAt).toISOString())}
                  </span>
                </p>
                {user.session.userAgent && (
                  <p className="muted">User agent: {user.session.userAgent}</p>
                )}
                <SignOut />
              </div>
            </Panel>
          </div>
          <div id="danger">
            <Panel title="Danger zone · Account erasure">
              <DeleteAccount />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
