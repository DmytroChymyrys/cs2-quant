"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Activity, Search, Settings2, Bell, BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="FloatAlpha home">
      <span className="brand-glyph">
        <Activity size={20} />
      </span>
      <span className="wordmark">
        FloatAlpha<small>CS2 Market Intelligence</small>
      </span>
    </Link>
  );
}
const links = [
  ["Terminal", "/terminal"],
  ["Screener", "/screener"],
  ["Assets", "/assets"],
  ["Watchlist", "/watchlist"],
  ["Portfolio", "/portfolio"],
  ["Alerts", "/alerts"],
];
export function AppShell({ children }: { children: ReactNode }) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const pathname = usePathname(),
    router = useRouter(),
    search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        if (document.activeElement === search.current) {
          setSearchExpanded(false);
          search.current?.blur();
          previousFocus.current?.focus();
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        const disclosure = active?.closest<HTMLDetailsElement>(
          ".mobile-nav[open], .freshness-strip > details[open]",
        );
        if (disclosure) {
          disclosure.open = false;
          disclosure.querySelector<HTMLElement>("summary")?.focus();
        }
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)))
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        previousFocus.current = document.activeElement as HTMLElement;
        setSearchExpanded(true);
        requestAnimationFrame(() => search.current?.focus());
      }
      const route: Record<string, string> = {
        t: "/terminal",
        s: "/screener",
        w: "/watchlist",
      };
      if (route[event.key]) router.push(route[event.key]);
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [router]);
  const personal = [
    "/watchlist",
    "/alerts",
    "/portfolio",
    "/settings",
  ].includes(pathname);
  const nav = (
    <nav className="nav" aria-label="Market navigation">
      {links.map(([name, href]) => (
        <Link
          key={href}
          className={pathname === href ? "active" : ""}
          aria-current={pathname === href ? "page" : undefined}
          href={href}
        >
          {name}
        </Link>
      ))}
    </nav>
  );
  return (
    <>
      <a className="skip" href="#main-content">
        Skip to content
      </a>
      {personal && <PublicHeader />}
      <header className="topbar">
        <Brand />
        {nav}
        <form
          className="top-search"
          action="/assets"
          data-keyboard-open={searchExpanded || undefined}
        >
          <Search size={13} />
          <input
            ref={search}
            className="input"
            name="q"
            placeholder="FIND AN ASSET"
            aria-label="Find an asset"
            aria-keyshortcuts="/"
            onBlur={() => setSearchExpanded(false)}
          />
          <kbd aria-hidden="true">{searchExpanded ? "Esc" : "/"}</kbd>
        </form>
        <span className="header-feed">
          <span className="dot" />
          SKINPORT
          <br />
          PILOT UNIVERSE
        </span>
        <div className="top-utils">
          <Link
            className="notification-control"
            href="/alerts"
            aria-label="Alerts and notifications"
          >
            <Bell size={16} />
          </Link>
          <Link className="btn small" href="/pricing">
            <BadgeCheck size={12} /> Free / Pro
          </Link>
          <Link
            href="/settings"
            className="btn icon"
            aria-label="Account and settings"
          >
            <Settings2 size={15} />
          </Link>
        </div>
        <details className="mobile-nav">
          <summary>Market navigation</summary>
          {nav}
        </details>
      </header>
      <main id="main-content" className="terminal market-workspace">
        {children}
      </main>
      <footer className="statusbar">
        <span>SKINPORT · PILOT UNIVERSE · USD</span>
        <span>Market observations, not investment advice.</span>
        <span className="keyboard-legend">
          <kbd>/</kbd> Search <kbd>T</kbd> Terminal <kbd>S</kbd> Screener{" "}
          <kbd>W</kbd> Watchlist
        </span>
      </footer>
      {personal && <PublicFooter />}
    </>
  );
}
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main-content">
        Skip to content
      </a>
      <PublicHeader />
      <main id="main-content">{children}</main>
      <PublicFooter />
    </>
  );
}

export function PublicHeader() {
  return (
    <header className="section-border">
      <div className="public-nav">
        <Brand />
        <nav aria-label="Public navigation">
          <Link href="/terminal">Platform</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/#data">Data & methodology</Link>
        </nav>
        <div className="row">
          <Link href="/login">Sign in</Link>
          <Link className="btn primary" href="/signup">
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
export function PublicFooter() {
  return (
    <footer className="product-footer">
      <div className="footer-brand">
        <Brand />
        <p>
          CS2 market observations.
          <br />
          Price, supply and activity in context.
        </p>
      </div>
      <div>
        <h3>Platform</h3>
        <Link href="/terminal">Market terminal</Link>
        <Link href="/screener">Asset screener</Link>
        <Link href="/portfolio">Portfolio</Link>
      </div>
      <div>
        <h3>Data & methodology</h3>
        <Link href="/#data">Data transparency</Link>
        <Link href="/assets">Tracked universe</Link>
        <Link href="/pricing">Free / Pro capabilities</Link>
      </div>
      <div>
        <h3>Account</h3>
        <Link href="/settings">Account & billing</Link>
        <Link href="/watchlist">Watchlist</Link>
        <Link href="/alerts">Condition alerts</Link>
      </div>
      <div className="footer-disclosure">
        <span>FloatAlpha · CS2 market intelligence</span>
        <span>
          Skinport observations. Not affiliated with Valve or Counter-Strike.
        </span>
      </div>
    </footer>
  );
}
