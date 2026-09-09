import { DeleteAccount } from "@/components/delete-account";
import { currentUser } from "@/lib/product/auth";
import { entitlements } from "@/lib/product/entitlements";
import { timestamp } from "@/lib/product/format";
import { AuthRequired } from "@/components/auth-required";
import { PageHeading, Panel, SemanticBadge, LinkButton } from "@/components/ui";
import { PreferencesForm } from "@/components/preferences-form";
import { MutationButton, SignOut } from "@/components/product-actions";
export default async function Settings() {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="account" />;
  const caps = await entitlements(user.app.id);
  return (
    <>
      <PageHeading
        eyebrow="Account & billing"
        title="Your workspace"
        description="Identity, monitoring preferences, subscription, and sessions."
        action={<SignOut />}
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Account sections">
          <a href="#identity">Account identity</a>
          <a href="#preferences">Monitoring preferences</a>
          <a href="#billing">Subscription & billing</a>
          <a href="#security">Security & sessions</a>
          <a href="#danger">Danger zone</a>
        </nav>
        <div className="stack">
          <div id="identity">
            <Panel title="Account identity">
              <div className="pad stack">
                <h2>{user.identity.name}</h2>
                <p>{user.identity.email}</p>
                <SemanticBadge
                  state={
                    user.identity.emailVerified ? "VERIFIED" : "UNVERIFIED"
                  }
                />
              </div>
            </Panel>
          </div>
          <div id="preferences">
            <Panel title="Market & monitoring preferences">
              <div className="pad">
                <PreferencesForm
                  initialCategories={user.app.categories}
                  initialInterests={user.app.interests}
                />
              </div>
            </Panel>
          </div>
          <div id="billing">
            <Panel title="Subscription & billing">
              <div className="pad stack">
                <h2>{caps.plan}</h2>
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
                  <MutationButton
                    label="Manage billing"
                    endpoint="/api/product/billing/portal"
                  />
                  <LinkButton href="/pricing">Compare plans</LinkButton>
                </div>
              </div>
            </Panel>
          </div>
          <div id="security">
            <Panel title="Current session">
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
            <Panel title="Danger zone">
              <DeleteAccount />
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
