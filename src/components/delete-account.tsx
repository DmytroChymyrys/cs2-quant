"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";
import { Dialog } from "./dialog";
export function DeleteAccount() {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const router = useRouter();
  return (
    <div className="pad stack">
      <p>
        Delete your account and its saved watchlist, portfolio, preferences, and
        alerts. Market observations remain in the shared dataset.
      </p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Dialog
        title="Delete your account"
        open={open}
        onClose={() => setOpen(false)}
      >
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            if (confirmation !== "DELETE") return;
            setBusy(true);
            setError("");
            const password = String(
              new FormData(e.currentTarget).get("password") ?? "",
            );
            try {
              const r = await fetch("/api/auth/delete-user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(password ? { password } : {}),
              });
              const b = await r.json();
              if (!r.ok)
                setError(
                  b.message ??
                    "Unable to delete account. Sign in again and retry.",
                );
              else {
                router.push("/");
                router.refresh();
              }
            } catch {
              setError("Network error. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Notice>
            Cancel any active subscription first. This removes your personal
            records and cannot be undone.
          </Notice>
          <label>
            Type DELETE to confirm
            <input
              className="input"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Password (email accounts)
            <input
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
            />
          </label>
          <p className="muted">
            Google accounts must have signed in within the last five minutes.
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <Button variant="danger" disabled={busy || confirmation !== "DELETE"}>
            {busy ? "Deleting…" : "Permanently delete account"}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
