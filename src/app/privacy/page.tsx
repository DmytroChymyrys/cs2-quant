import Link from "next/link";
import { PublicShell } from "@/components/shell";
import { ConsentPreference } from "@/components/consent-preference";
import { pageMetadata } from "@/lib/seo";
import {
  ACQUISITION_MAX_AGE_SECONDS,
  ACQUISITION_COOKIE,
} from "@/lib/acquisition";
import {
  CONSENT_COOKIE,
  CONSENT_POLICY_DAYS,
  CONSENT_REQUIRED_COOKIE,
  GOOGLE_PARTNER_SITES_URL,
} from "@/lib/consent";

/**
 * The privacy notice.
 *
 * Public and indexable: it is linked from the consent banner, so it must be
 * reachable before anyone authenticates or makes a choice. It deliberately
 * carries no `robots` override — `/privacy` is absent from DISALLOWED_PATHS, so
 * the default production policy allows it.
 *
 * Every statement below describes behaviour that exists in this repository. It
 * claims no compliance with any particular regime, promises no absolute
 * deletion or anonymity, and names no contact address, company or jurisdiction,
 * because none is recorded anywhere in the product.
 */
export const metadata = pageMetadata({
  title: "Privacy",
  description:
    "What FloatAlpha collects, what Google receives, and how to change your consent choice.",
  path: "/privacy",
});

const ACQUISITION_DAYS = Math.round(ACQUISITION_MAX_AGE_SECONDS / 86400);

export default function Privacy() {
  return (
    <PublicShell>
      <div className="stack prose">
        <h1>Privacy</h1>
        <p>
          FloatAlpha is a CS2 market-intelligence product. This notice describes
          what it collects and what it shares with Google. It is written to match
          what the product actually does today, and will change as the product
          does.
        </p>

        <h2>Account and authentication</h2>
        <p>
          You can create an account with an email address and password, with
          Google, or with Steam. FloatAlpha stores the identifier your chosen
          provider supplies — an email address, a Google account identifier, or a
          Steam ID — together with which method created the account.
        </p>
        <p>
          Steam does not supply an email address, so a Steam-created account has
          none unless you add one. Connecting a provider to an existing account
          links an identity; it does not create a second account.
        </p>
        <p>
          You can delete your account from Settings. Deletion removes your
          FloatAlpha profile and the data attached to it. It does not reach data
          already sent to Google, which is governed by Google&rsquo;s own
          retention, and it cannot remove information from backups or logs that
          have already been written.
        </p>

        <h2>Product data you create</h2>
        <p>
          Watchlist entries, manual portfolio holdings, saved screens, alert
          rules and market preferences are stored against your account. If you
          enable the Steam inventory integration, FloatAlpha reads the list of
          items in your CS2 inventory and stores what it observed, so it can show
          holdings and value them against observed market listings. That access
          is read-only: FloatAlpha cannot trade, move or hold items.
        </p>

        <h2>Analytics</h2>
        <p>
          FloatAlpha uses Google Analytics 4 on the production site only.
          Analytics records which pages are viewed and a small set of product
          events — opening an asset, using the screener, adding to a watchlist,
          completing signup, and similar.
        </p>
        <p>
          These events deliberately carry no personal data. No email address, no
          name, no Steam ID, no account identifier and no search text is sent.
          Where an event counts a search it sends the number of results, never
          the query. The internal operations console is excluded from analytics
          entirely.
        </p>

        <h2>Advertising measurement</h2>
        <p>
          FloatAlpha measures whether advertising produces new accounts. When an
          account is created, a <code>sign_up</code> event is recorded with the
          method used — Google, email or Steam — and, where the visit arrived
          from a campaign, the campaign source, medium and name. No identifier
          for you is attached to it.
        </p>
        <p>
          FloatAlpha is an advertiser measuring its own conversions. It does not
          sell data, does not operate an advertising network, and does not show
          third-party advertising on this site.
        </p>

        <h2>Google Consent Mode</h2>
        <p>
          In the EEA, the United Kingdom and Switzerland, advertising storage,
          advertising data use and ads personalization are switched off before
          you choose, and analytics storage is switched off with them. Nothing is
          granted until you act. Outside those regions they default on.
        </p>
        <p>
          Your choice is recorded in a cookie and honoured for{" "}
          {CONSENT_POLICY_DAYS} days before FloatAlpha asks again. That interval
          is a FloatAlpha decision, not a Google requirement. You can change your
          decision at any time, sooner, in{" "}
          <Link href="/settings#connected-accounts">Settings</Link> — the change
          applies immediately.
        </p>

        <h2>Campaign information</h2>
        <p>
          If you arrive with campaign parameters in the address — for example{" "}
          <code>utm_source</code> or <code>utm_campaign</code> — FloatAlpha
          records them, along with the page you landed on, in a cookie that lasts{" "}
          {ACQUISITION_DAYS} days. Only the first such visit is recorded, so a
          later direct visit does not overwrite it.
        </p>
        <p>
          Google advertising click identifiers (<code>gclid</code>,{" "}
          <code>gbraid</code>, <code>wbraid</code>) are recorded in the same
          cookie when present. They are kept so FloatAlpha can reconcile its own
          records against Google&rsquo;s reporting, and are <strong>not</strong>{" "}
          sent to Google Analytics — only the campaign labels above are.
        </p>
        <p>
          This is FloatAlpha&rsquo;s own record for understanding where accounts
          come from. It is not what Google uses to attribute advertising; Google
          does that with its own measurement.
        </p>

        <h2>Cookies and local storage</h2>
        <ul>
          <li>
            <code>{CONSENT_COOKIE}</code> — your consent choice, {CONSENT_POLICY_DAYS} days.
          </li>
          <li>
            <code>{CONSENT_REQUIRED_COOKIE}</code> — whether a consent choice is
            required for your region, so the banner is shown only where it
            applies.
          </li>
          <li>
            <code>{ACQUISITION_COOKIE}</code> — first-touch campaign information,{" "}
            {ACQUISITION_DAYS} days.
          </li>
          <li>
            Session cookies, which keep you signed in. These are necessary for
            the product to work and are not used for measurement.
          </li>
          <li>
            Google Analytics cookies, set by Google, and only where analytics
            storage is permitted. Some product preferences are kept in your
            browser&rsquo;s local storage and are never sent to us.
          </li>
        </ul>

        <h2>Where market data comes from</h2>
        <p>
          Market observations originate from third-party sources, described in{" "}
          <Link href="/methodology">data sources and methodology</Link>. That
          page also sets out what the numbers do and do not measure.
        </p>

        <h2>Google&rsquo;s role</h2>
        <p>
          Google Analytics and Google Ads are operated by Google, not by
          FloatAlpha. What FloatAlpha sends is described above; what Google then
          does with it is governed by Google. See{" "}
          <a href={GOOGLE_PARTNER_SITES_URL} target="_blank" rel="noreferrer">
            how Google uses data from sites that use its services
          </a>
          .
        </p>
        <p>
          Signing in with Google or with Steam involves those services directly,
          under their own terms. FloatAlpha receives only the account identifier
          each returns.
        </p>

        <h2>Changing your consent choice</h2>
        <p>
          Use the control below, or the same control in Settings. It appears only
          where a consent choice applies to you.
        </p>
        <ConsentPreference />

        <h2>Contact</h2>
        <p>
          Write to <a href="mailto:info@floatalpha.com">info@floatalpha.com</a>{" "}
          with any question about this notice or your data. Account deletion and
          your consent choice are both available directly in{" "}
          <Link href="/settings">Settings</Link>.
        </p>
      </div>
    </PublicShell>
  );
}
