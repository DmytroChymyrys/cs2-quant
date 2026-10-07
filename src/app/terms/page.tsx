import Link from "next/link";
import { PublicShell } from "@/components/shell";
import { pageMetadata } from "@/lib/seo";

/**
 * Terms of use.
 *
 * Deliberately short, and deliberately incomplete relative to a conventional
 * terms document. Everything a normal Terms would say about the legal entity,
 * governing law, venue, arbitration, age limits, refunds or paid subscription
 * obligations requires facts that do not exist anywhere in this repository, so
 * those clauses are OMITTED rather than guessed. The P1A report lists each one.
 *
 * What remains is what the product can actually substantiate: what FloatAlpha
 * is, what the data can and cannot support, what an account holder is
 * responsible for, and that this is early access which will change.
 */
export const metadata = pageMetadata({
  title: "Terms of use",
  description:
    "The terms on which FloatAlpha's market-research product is provided during early access.",
  path: "/terms",
});

export default function Terms() {
  return (
    <PublicShell>
      <div className="stack prose">
        <h1>Terms of use</h1>
        <p className="muted">
          These terms describe how FloatAlpha is provided today. FloatAlpha is in
          early access and both the product and these terms will change.
        </p>

        <h2>What FloatAlpha is</h2>
        <p>
          FloatAlpha is an independent market-intelligence and research product
          for CS2 skins. It observes public market data, stores what it saw and
          when, and derives analytics from that record. It is a research tool: it
          does not execute trades, hold items, take custody of anything, or act
          as a marketplace or broker.
        </p>

        <h2>Information, not advice</h2>
        <p>
          Everything FloatAlpha shows is market information for research
          purposes. <strong>It is not financial or investment advice</strong>, not
          a recommendation, not a valuation and not a forecast. Decisions you make
          using it are yours. Past observations do not indicate future prices or
          activity.
        </p>

        <h2>Accuracy and availability of market data</h2>
        <p>
          Market information can be incomplete, delayed, unavailable or
          inaccurate. Coverage is a selected universe of tracked assets rather
          than the whole market, history begins when collection began, and
          observations describe listings at a venue rather than executed trades.
          FloatAlpha reports unavailable data as unavailable rather than
          estimating through it; see{" "}
          <Link href="/methodology">data sources and methodology</Link> for what
          each number measures and its limits.
        </p>

        <h2>Third-party sources</h2>
        <p>
          Market observations originate from third-party sources. Those sources
          are independent of FloatAlpha, and their availability, rate limits or
          changes can delay, reduce or interrupt what FloatAlpha can show.
          Third-party names and trademarks belong to their respective owners and
          are used only to describe where data came from.{" "}
          <strong>
            No partnership, sponsorship, endorsement or affiliation should be
            inferred
          </strong>{" "}
          between FloatAlpha and any venue, Valve or Counter-Strike.
        </p>

        <h2>Your account</h2>
        <p>
          You are responsible for keeping access to your account secure, for
          activity that happens through it, and for the accuracy of anything you
          enter, such as manual portfolio holdings. Connecting Google or Steam
          links an identity for sign-in; the Steam inventory integration, if you
          enable it, is read-only and cannot trade or move items. You can delete
          your account at any time from Settings.
        </p>

        <h2>Acceptable use</h2>
        <p>Please do not:</p>
        <ul>
          <li>
            attempt to gain unauthorised access to the service, other accounts or
            the underlying systems;
          </li>
          <li>
            scrape, bulk-extract or redistribute the data in a way that bypasses
            the product&rsquo;s normal use;
          </li>
          <li>
            circumvent access limits, rate limits or authentication, or create
            accounts to do so;
          </li>
          <li>
            interfere with the service&rsquo;s operation or with other
            people&rsquo;s use of it;
          </li>
          <li>use the service for anything unlawful.</li>
        </ul>
        <p>
          We may suspend or remove access to accounts used this way.
        </p>

        <h2>Early access</h2>
        <p>
          FloatAlpha is in early access. Features are added, changed and removed;
          data coverage and history depth change; and the product may be
          unavailable at times. During early access the full currently available
          product is provided at no cost. That is not a subscription, not a trial
          and creates no billing record, and it is not a permanent entitlement —
          what is included can change.
        </p>

        <h2>Availability</h2>
        <p>
          The service is provided as it is, without any guarantee of uptime,
          continuity or that it will be error-free. Access can be interrupted for
          maintenance, by a third-party source becoming unavailable, or for
          reasons outside our control.
        </p>

        <h2>Related documents</h2>
        <p>
          <Link href="/privacy">Privacy</Link> describes what data FloatAlpha
          collects and what Google receives.{" "}
          <Link href="/methodology">Data sources and methodology</Link> describes
          where market observations come from and what they measure. Both form
          part of how the service is provided.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href="mailto:info@floatalpha.com">info@floatalpha.com</a>.
        </p>
      </div>
    </PublicShell>
  );
}
