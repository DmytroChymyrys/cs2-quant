"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "./ui";

export function BillingReturn({
  checkout,
  plan,
}: {
  checkout?: string;
  plan: "Free" | "Pro";
}) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    if (checkout !== "success" || plan === "Pro") return;
    let stopped = false,
      attempts = 0;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (++attempts > 15) {
        clearInterval(timer);
        setWaiting(false);
        return;
      }
      try {
        const response = await fetch("/api/product/billing/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok && (await response.json()).plan === "Pro" && !stopped) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        /* Bounded retry; access always comes from the server. */
      }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [checkout, plan, router]);
  if (checkout !== "success") return null;
  return (
    <Notice>
      {plan === "Pro"
        ? "Sandbox subscription confirmed. Pro access is active."
        : waiting
          ? "Checkout returned. Waiting for Stripe to confirm the subscription; access has not changed yet."
          : "Confirmation is still pending. Refresh this page shortly to check your subscription."}
    </Notice>
  );
}
