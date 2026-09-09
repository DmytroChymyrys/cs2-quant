"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";
export function CheckoutButton({
  interval,
  available,
}: {
  interval: "month" | "year";
  available: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="stack">
      <Button
        variant="primary"
        disabled={!available || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch("/api/product/billing/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ interval }),
            });
            if (r.status === 401) {
              router.push("/login");
              return;
            }
            const b = await r.json();
            if (r.ok && b.url) window.location.assign(b.url);
            else setMessage(b.message ?? "Checkout is unavailable.");
          } catch {
            setMessage("Network error. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Opening checkout…"
          : available
            ? "Continue to Stripe"
            : "Subscriptions unavailable"}
      </Button>
      {message && (
        <p role="alert" className="field-error">
          {message}
        </p>
      )}
    </div>
  );
}
