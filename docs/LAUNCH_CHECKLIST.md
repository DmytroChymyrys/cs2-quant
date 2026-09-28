# FloatAlpha — Analytics & Search Console Launch Checklist

Written for Dmytro. Everything below is a step in a Google product that cannot
be done from the codebase. Anything that *could* be done in code already has
been; where a value must come from Google, this says so rather than inventing
one.

Status as of the last deployment to `https://floatalpha.com`.

---

## Already done — no action needed

| Item | State |
| --- | --- |
| GA4 script on production | Live, verified executing in a browser |
| Measurement ID | `G-HJTW09JC1Y`, set as `NEXT_PUBLIC_GA_MEASUREMENT_ID` |
| Production-only gating | Verified both ways — preview deployments load nothing |
| Page views | 1 per landing, 1 per client-side navigation — no duplication |
| Custom events | 8, typed in one union, no PII, no commerce events |
| Consent Mode v2 | Live. Verified `gcs: G101` on a real collect request |
| `robots.txt` | Live, production policy |
| `sitemap.xml` | Live, 110 URLs, valid XML, ~55 ms |
| Canonical URLs | Every public page, no Vercel hostnames |
| Asset slugs + 308 redirects | Live |
| Structured data | Organization, WebSite, WebApplication, BreadcrumbList, ItemList |

---

## 1. Google Analytics — settings only you can change

These are GA4 property settings. None of them are code.

### 1.1 Enhanced measurement — required, or SPA navigations go uncounted

**Admin → Data streams → your web stream → Enhanced measurement →
Page changes based on browser history events must be ON.**

This one matters more than it looks. FloatAlpha deliberately sends **no manual
`page_view`** on route change, because sending one *alongside* enhanced
measurement double-counts every navigation. The app relies on this setting to
count client-side navigations. If it is off, only first loads are measured.

It is on by default. Confirm it, do not assume it.

### 1.2 Data retention — change it, the default is short

**Admin → Data settings → Data retention → set event data retention to
14 months**, and enable "Reset user data on new activity".

The default is 2 months. Anything older than the window is gone from
exploration reports permanently — it cannot be recovered later by changing the
setting. Do this before you accumulate history worth keeping.

### 1.3 Google signals — leave OFF

**Admin → Data settings → Data collection → Google signals.**

FloatAlpha denies `ad_storage`, `ad_user_data` and `ad_personalization`
unconditionally, because it runs no advertising. Enabling Google signals would
contradict the consent state the site declares on every page.

### 1.4 Internal traffic — optional but worth it

**Admin → Data streams → Configure tag settings → Define internal traffic**,
then **Admin → Data filters** to activate the filter.

Your own visits will otherwise dominate early data while traffic is low.

### 1.5 Consent behaviour you should expect

EEA, UK and Swiss visitors have `analytics_storage: denied` by default,
because FloatAlpha has no consent banner. They are measured by Google's
cookieless modelling, not by stored identifiers, so those regions will show
fewer users than reality and no cross-session continuity.

That is a deliberate trade — not a bug, and not something to "fix" in GA.
**To change it, the product needs a consent banner**, after which a single
`gtag('consent', 'update', { analytics_storage: 'granted' })` on acceptance
upgrades those visitors. No other code change is required.

---

## 2. Google Search Console

### 2.1 Property verification

The `floatalpha.com` **Domain property** already exists in your account.

If it is verified, skip to 2.2. If Google asks you to re-verify, it will show
a DNS TXT record of the form:

```
Host:  floatalpha.com   (or @)
Type:  TXT
Value: google-site-verification=<value Google shows you>
```

**Supply that value from Google's screen — it is not in this repository and I
have not invented one.** Add it at your DNS provider (the same place the
Vercel records live). A Domain property is the stronger choice: it covers
`www`, non-`www`, `http` and `https` in one.

**Alternative, if DNS is inconvenient.** The HTML-tag method is wired up and
needs no code change:

1. In Search Console choose a **URL prefix** property for `https://floatalpha.com`
2. Pick the **HTML tag** method; Google shows
   `<meta name="google-site-verification" content="TOKEN">`
3. Set the token (the `content` value only, not the whole tag) in Vercel:
   ```
   vercel env add GOOGLE_SITE_VERIFICATION production
   ```
4. **Redeploy** — the tag is inlined at build time, so verification will fail
   until a new deployment carries it
5. Click Verify

### 2.2 Re-submit the sitemap — this is the outstanding item

The Sitemaps page still shows **"Couldn't fetch"**, **Submitted `Sep 28, 2026`**,
**Last read empty**. Empty "Last read" means Google has never successfully read
it, and that single attempt happened while the sitemap was slow. It has been
fixed since — it now serves in about 55 ms, and 25 consecutive crawler-style
fetches succeeded with zero timeouts.

Google caches that failure, so waiting will not clear it:

1. Search Console → **Sitemaps**
2. **⋮** on the `https://floatalpha.com/sitemap.xml` row → **Remove sitemap**
3. Re-add `sitemap.xml` under "Add a new sitemap" → **Submit**

Removing first is the part that matters. Re-submitting the same URL without
removing often just redisplays the cached failure.

Expect: Type `Unknown` → `Sitemap`, Last read populated, **Discovered pages
110**.

If it still fails after a genuine remove-and-re-add, use **URL inspection** on
`https://floatalpha.com/sitemap.xml` → **Test live URL**, which reports what
Google receives at that moment. Send me that output and I will work from it.

### 2.3 Request indexing for the entry points

**URL inspection → paste URL → Request indexing**, for:

```
https://floatalpha.com/
https://floatalpha.com/terminal
https://floatalpha.com/assets
https://floatalpha.com/screener
https://floatalpha.com/cs2-skins
```

The 5 category pages and 99 asset pages will be discovered through the sitemap
and the internal link graph; they do not each need a manual request.

### 2.4 Link Search Console to GA4 — optional

**GA4 Admin → Product links → Search Console links.** Puts query and landing
page data into GA4 reports. Nothing depends on it.

### 2.5 What to watch, and what not to panic about

- **Pages → Not indexed** is normal early. "Discovered – currently not indexed"
  means Google knows about the URL and has not got to it.
- Asset URLs recently changed from UUIDs to slugs, with 308 redirects. You will
  see the old UUID URLs reported as redirects for a while. That is the
  migration working, not a fault.
- Coverage of 99 asset pages will not appear all at once. Indexing a new domain
  is measured in weeks.

---

## 3. Values you must supply

Only two, and neither can be produced from this repository:

| Value | Where it comes from | What to do with it |
| --- | --- | --- |
| Search Console DNS TXT | Shown by Google during Domain verification | Add at your DNS provider |
| `GOOGLE_SITE_VERIFICATION` | Shown by Google if you use the HTML-tag method instead | `vercel env add`, then redeploy |

The GA4 Measurement ID is already configured — nothing further is needed there.

---

## 4. Known gap, recorded rather than worked around

**The holdings keyword cluster has no indexable surface.** `CS2 inventory
value`, `CS2 portfolio tracker` and `CS2 inventory tracker` all describe
`/portfolio` and `/watchlist`, which are account-specific and correctly
`noindex`.

Serving that intent needs a *public* page explaining inventory valuation —
methodology and a worked example — not an indexable version of anyone's
portfolio. That is a product decision, not a data one. See
`docs/SEO_STRATEGY.md` §10, Stage 3.

**Signup is also still closed.** No auth provider is configured, so the
"Join the Preview" path cannot complete. Organic traffic arriving before that
is fixed will bounce. Either Google OAuth (`GOOGLE_CLIENT_ID` +
`GOOGLE_CLIENT_SECRET`) or Resend (`RESEND_API_KEY` + `EMAIL_FROM`) opens it.

---

## 5. Freeze

The SEO surface is frozen at the routes in `docs/SEO_STRATEGY.md`.
`tests/seo-freeze.test.ts` pins the indexable route families, the category
taxonomy, and the absence of weapon-level routes. A new programmatic page
family fails the suite rather than appearing unnoticed.

Unfreezing is deliberate: update the strategy document and the test expectation
together.
