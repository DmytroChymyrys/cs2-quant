"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Activity, Search, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="cs2-quant home">
      <span className="brand-glyph">
        <Activity size={20} />
      </span>
      <span className="wordmark">
        cs2-quant<small>CS2 Market Intelligence</small>
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
  const pathname = usePathname(),
    router = useRouter(),
    search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
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
        search.current?.focus();
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
      <header className="topbar">
        <Brand />
        {nav}
        <form className="top-search" action="/assets">
          <Search size={13} />
          <input
            ref={search}
            className="input"
            name="q"
            placeholder="FIND AN ASSET  /"
            aria-label="Find an asset"
          />
        </form>
        <div className="top-utils">
          <Link className="btn small" href="/pricing">
            Free / Pro
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
      <main id="main-content" className="terminal">
        {children}
      </main>
      <footer className="statusbar">
        <span>SKINPORT · PILOT UNIVERSE · USD</span>
        <span>Market observations, not investment advice.</span>
        <span>/ Search · T Terminal · S Screener · W Watchlist</span>
      </footer>
    </>
  );
}
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#main-content">
        Skip to content
      </a>
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
      <main id="main-content">{children}</main>
      <footer className="section-border">
        <div className="public-footer">
          <Brand />
          <span>
            Skinport observations. Transparent methods.
            <br />
            Analytics, not investment advice.
          </span>
          <div className="row">
            <Link href="/terminal">Terminal</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/settings">Account</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
