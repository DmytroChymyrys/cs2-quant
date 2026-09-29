"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Account lifecycle controls for one row of the ops users table.
 *
 * Block and soft delete are reversible, so they act on one click with a reason
 * prompt. A hard delete is not, so it opens a dialog that states exactly what
 * will be removed — read from the server, not guessed here — and requires the
 * account's email address to be typed back. The server compares that address
 * against the row it is about to delete, so this control cannot talk it into
 * deleting a different one.
 */

type Cascade = Record<string, number>;

const LABEL: Record<string, string> = {
  watchlist: "watchlist entries",
  holdings: "portfolio holdings",
  screens: "saved screens",
  alerts: "alert rules",
  subscriptions: "billing records",
};

export function OpsUserActions({
  userId,
  email,
  status,
}: {
  userId: string;
  email: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cascade, setCascade] = useState<Cascade | null>(null);
  const [typed, setTyped] = useState("");

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.message ?? "That did not work.");
        return null;
      }
      return payload;
    } catch {
      setError("That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string, needsReason = false) => {
    const reason = needsReason
      ? (window.prompt("Reason (recorded in the audit log, optional)") ??
        undefined)
      : undefined;
    if ((await call({ action, reason })) !== null) router.refresh();
  };

  const openConfirm = async () => {
    const preview = await call({ action: "preview" });
    if (!preview) return;
    setCascade(preview.cascade as Cascade);
    setTyped("");
    setConfirming(true);
  };

  const confirmDelete = async () => {
    const reason =
      window.prompt("Reason (recorded in the audit log, optional)") ??
      undefined;
    const done = await call({
      action: "hard-delete",
      confirmEmail: typed,
      reason,
    });
    if (done) {
      setConfirming(false);
      router.refresh();
    }
  };

  const deleted = status === "Deleted";
  const blocked = status === "Blocked";

  return (
    <div className="ops-actions">
      {blocked ? (
        <button disabled={busy} onClick={() => act("unblock")}>
          Unblock
        </button>
      ) : (
        <button disabled={busy || deleted} onClick={() => act("block", true)}>
          Block
        </button>
      )}
      {deleted ? (
        <button disabled={busy} onClick={() => act("restore")}>
          Restore
        </button>
      ) : (
        <button disabled={busy} onClick={() => act("soft-delete", true)}>
          Soft delete
        </button>
      )}
      <button
        className="ops-danger"
        disabled={busy}
        onClick={openConfirm}
        aria-haspopup="dialog"
      >
        Delete permanently
      </button>
      {error && (
        <span role="alert" className="ops-error">
          {error}
        </span>
      )}
      {confirming && (
        <div className="ops-confirm" role="dialog" aria-modal="true">
          <div className="ops-confirm-card">
            <h3>Delete {email} permanently?</h3>
            <p>
              This cannot be undone. The account and everything below it are
              removed, and the address becomes available to register again.
            </p>
            <ul>
              {Object.entries(cascade ?? {}).map(([key, count]) => (
                <li key={key}>
                  {count} {LABEL[key] ?? key}
                </li>
              ))}
            </ul>
            <p>
              An active subscription is cancelled in Stripe first. If that
              cancellation fails nothing is deleted.
            </p>
            <label>
              Type <strong>{email}</strong> to confirm
              <input
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="ops-confirm-buttons">
              <button onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button
                className="ops-danger"
                disabled={
                  busy || typed.trim().toLowerCase() !== email.toLowerCase()
                }
                onClick={confirmDelete}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
