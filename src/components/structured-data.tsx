import { SITE_DESCRIPTION, SITE_NAME, canonicalOrigin } from "@/lib/seo";

/**
 * Site-wide JSON-LD.
 *
 * Only properties FloatAlpha can substantiate are emitted. There are
 * deliberately no ratings, review counts, user counts, awards or `offers`:
 * Pro is not purchasable during Preview, and an `offers` block would tell
 * search engines a paid subscription can be bought today. Adding any of those
 * later requires a real source for the number, not an estimate.
 */
export function StructuredData() {
  const origin = canonicalOrigin();
  // Structured data requires absolute URLs. Without a resolved origin there is
  // nothing truthful to emit, so emit nothing.
  if (!origin) return null;
  const base = origin.origin;
  const graph = [
    {
      "@type": "Organization",
      "@id": `${base}/#organization`,
      name: SITE_NAME,
      url: base,
      description: SITE_DESCRIPTION,
    },
    {
      /*
       * What Google reads to decide the site name shown above a search
       * result — the line that otherwise reads "floatalpha.com".
       *
       * It only reads this from the home page, and applies it on its own
       * re-crawl schedule, so a correct declaration here is necessary but not
       * sufficient: the change lands when Google decides it does.
       *
       * alternateName is the other form people type — the brand is one word,
       * but it gets searched spaced.
       */
      "@type": "WebSite",
      "@id": `${base}/#website`,
      name: SITE_NAME,
      alternateName: "Float Alpha",
      url: base,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${base}/#organization` },
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${base}/#application`,
      name: SITE_NAME,
      url: base,
      description: SITE_DESCRIPTION,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web browser",
      browserRequirements: "Requires JavaScript.",
      publisher: { "@id": `${base}/#organization` },
    },
  ];
  return (
    <script
      type="application/ld+json"
      // The payload is built from constants and a validated origin, never from
      // user input, so there is no injection surface here.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }),
      }}
    />
  );
}
