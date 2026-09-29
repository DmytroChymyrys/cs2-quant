"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { analyticsExcludedPath } from "@/lib/ga";

/**
 * Withholds analytics on routes that must not be measured.
 *
 * The tag is mounted in the root layout so it survives client-side navigation,
 * which also means it would otherwise load on the internal console. The check
 * lives in a client component because only the browser router knows the
 * current path; returning null means the script is never injected at all,
 * rather than injected and then told to stay quiet.
 *
 * It re-evaluates on navigation, so moving from a measured page into the
 * console stops further collection for that view.
 */
export function AnalyticsRouteGate({ children }: { children: ReactNode }) {
  return analyticsExcludedPath(usePathname()) ? null : <>{children}</>;
}
