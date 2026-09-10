"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/catalog/browsing";
import {
  browseUrl,
  type BrowseParams,
} from "@/lib/product/intelligence/browse-state";
export function MarketCategoryTabs({
  path,
  params,
  selected,
  counts,
}: {
  path: string;
  params: BrowseParams;
  selected: MarketCategory;
  counts: Record<MarketCategory, number>;
}) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = nav.current,
      active = container?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!container || !active) return;
    const c = container.getBoundingClientRect(),
      a = active.getBoundingClientRect();
    if (a.left < c.left || a.right > c.right)
      container.scrollLeft += a.left - c.left - (c.width - a.width) / 2;
  }, [selected]);
  return (
    <nav
      ref={nav}
      className="category-tabs market-category-tabs"
      aria-label="Item categories"
    >
      {(Object.entries(MARKET_CATEGORIES) as [MarketCategory, string][])
        .filter(
          ([key]) =>
            !["stickers", "other"].includes(key) ||
            counts[key] > 0 ||
            selected === key,
        )
        .map(([key, label]) => (
          <Link
            key={key}
            prefetch={false}
            scroll={false}
            className={selected === key ? "active" : ""}
            aria-current={selected === key ? "page" : undefined}
            href={browseUrl(path, params, {
              category: key === "all" ? null : key,
            })}
          >
            {label} <span className="category-count">{counts[key]}</span>
          </Link>
        ))}
    </nav>
  );
}
