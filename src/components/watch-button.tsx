"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { Button } from "./ui";
export function WatchButton({
  assetId,
  initial = false,
  authenticated = false,
}: {
  assetId: string;
  initial?: boolean;
  authenticated?: boolean;
}) {
  const router = useRouter();
  const [watched, setWatched] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    void fetch("/api/product/watchlist")
      .then(async (r) => {
        if (r.ok) {
          const b = await r.json();
          if (active)
            setWatched(
              b.entries.some(
                (entry: { assetId: string }) => entry.assetId === assetId,
              ),
            );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [assetId, authenticated]);
  return (
    <div className="stack">
      <Button
        disabled={busy}
        onClick={async () => {
          if (!authenticated) {
            router.push("/login");
            return;
          }
          setBusy(true);
          setMessage("");
          try {
            const r = await fetch("/api/product/watchlist", {
              method: watched ? "DELETE" : "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ assetId }),
            });
            if (r.status === 401) {
              router.push("/login");
              return;
            }
            const b = await r.json();
            if (!r.ok) {
              setMessage(b.message ?? "Unable to update watchlist.");
              return;
            }
            setWatched(!watched);
          } catch {
            setMessage("Network error. Please try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Star size={14} fill={watched ? "currentColor" : "none"} />
        {busy
          ? "Saving…"
          : watched
            ? "Remove from watchlist"
            : "Add to watchlist"}
      </Button>
      {message && (
        <p role="alert" className="field-error">
          {message}
        </p>
      )}
    </div>
  );
}
