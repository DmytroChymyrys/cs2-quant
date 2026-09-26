"use client";
import { useEffect, useRef } from "react";
import { track, type AnalyticsEvent } from "@/lib/ga";

/**
 * Emits one product event when a server-rendered page mounts.
 *
 * Rendering this is how a server component reports an event, so pages stay
 * server components and no page needs its own client wrapper.
 *
 * Fires once per distinct `key`. React's development StrictMode invokes
 * effects twice, and a client-side navigation back to the same route remounts
 * the tree, so an unguarded effect would double-count. The key is what
 * identifies the occurrence — an asset id, for instance — and changing it is
 * what permits a new event.
 */
export function TrackEvent({
  event,
  eventKey,
}: {
  event: AnalyticsEvent;
  eventKey: string;
}) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === eventKey) return;
    sent.current = eventKey;
    track(event);
    // `event` is recreated on every render by its parent; `eventKey` is the
    // stable identity, so it alone governs whether this fires again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventKey]);
  return null;
}
