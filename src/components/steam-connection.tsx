"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";
import { Dialog } from "./dialog";

type Connection = { id: string; steamId: string; connectedAt: string } | null;
const outcomes: Record<string, string> = {
  cancelled: "Steam connection was cancelled. You can continue without it.",
  failed:
    "Steam could not be connected. Your FloatAlpha account is unchanged. Please try again.",
  conflict:
    "This Steam account is linked to another FloatAlpha account. Sign in to that account to disconnect it first, or contact support. It has not been moved.",
  "already-connected":
    "A different Steam account is already connected. Disconnect it before linking another.",
};

export function SteamConnection({
  connection,
  enabled,
  flow = "settings",
  outcome,
}: {
  connection: Connection;
  enabled: boolean;
  flow?: "settings" | "onboarding";
  outcome?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reauthenticate, setReauthenticate] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const status =
    message ||
    (outcome ? outcomes[outcome] : "") ||
    (outcome === "connected" && connection
      ? "Steam is connected to this FloatAlpha account."
      : "");

  async function submit(disconnect = false) {
    setBusy(true);
    setMessage("");
    setReauthenticate(false);
    try {
      const response = await fetch(
        disconnect ? "/api/auth/unlink-account" : "/api/auth/steam/link",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            disconnect ? { accountId: connection?.id } : { flow },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || result.code === "SESSION_NOT_FRESH") {
          setReauthenticate(true);
          setMessage(
            "Please sign in again before changing your Steam connection.",
          );
        } else
          setMessage(
            "The connection could not be updated. Please try again. Your account remains available.",
          );
        return;
      }
      if (disconnect) {
        setConfirm(false);
        setMessage(
          "Steam disconnected. Your FloatAlpha account and saved data are unchanged.",
        );
        router.refresh();
      } else if (typeof result.url === "string") {
        const target = new URL(result.url, window.location.origin);
        if (
          target.origin !== window.location.origin &&
          !(
            target.origin === "https://steamcommunity.com" &&
            target.pathname === "/openid/login"
          )
        )
          throw Error();
        window.location.assign(target.toString());
      } else throw Error();
    } catch {
      setMessage(
        "Steam could not be reached. You can continue without connecting.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="stack"
      data-steam-connection={connection ? "connected" : "not-connected"}
    >
      <div className="row between">
        <h2>
          {flow === "onboarding" && !connection ? "Connect Steam" : "Steam"}
        </h2>
        <span className="eyebrow">
          {connection
            ? "Connected"
            : flow === "onboarding"
              ? "Optional · Recommended"
              : "Not connected"}
        </span>
      </div>
      {connection ? (
        <>
          <p>
            Your Steam identity is verified and linked to this FloatAlpha
            account.
          </p>
          <div className="account-fact">
            <span className="mono">Steam ID {connection.steamId}</span>
            <span className="muted">
              Connected {connection.connectedAt.slice(0, 10)} · UTC
            </span>
          </div>
        </>
      ) : (
        <p>
          Link your Steam identity to your FloatAlpha account. You can skip this
          and connect later from Settings.
        </p>
      )}
      <p className="muted">
        Steam shares your Steam ID. We store it and the connection date. We do
        not receive your Steam password or read inventory or trade history.
      </p>
      <div className="row">
        {connection ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Disconnect Steam
          </Button>
        ) : (
          <Button
            type="button"
            disabled={!enabled || busy}
            onClick={() => void submit()}
          >
            {busy ? "Opening Steam…" : "Connect Steam"}
          </Button>
        )}
        {flow === "onboarding" && !connection && !skipped && (
          <Button
            type="button"
            onClick={() => {
              setSkipped(true);
              document.getElementById("market-preferences")?.focus();
            }}
          >
            Maybe later
          </Button>
        )}
      </div>
      {!enabled && !connection && (
        <Notice>
          Steam connection is not available right now. Continue with your
          FloatAlpha account.
        </Notice>
      )}
      {skipped && (
        <p role="status">
          Skipped for now. Continue with your market preferences below.
        </p>
      )}
      {!confirm && status && <p role="status">{status}</p>}
      {!confirm && reauthenticate && (
        <Link
          className="cyan"
          href={`/login?next=${encodeURIComponent(`/${flow}`)}`}
        >
          Sign in again
        </Link>
      )}
      <details>
        <summary>Connection privacy and removal</summary>
        <p>
          Connecting verifies account ownership only. It does not change your
          plan, enable inventory syncing, or share your market activity. Your
          email and existing login methods remain available.
        </p>
        <p>
          Disconnecting removes the stored Steam identity and connection date.
          Deleting your FloatAlpha account also removes the link. Temporary
          verification records expire within eleven minutes and are removed on a
          later connection attempt or authentication cleanup. Your saved
          watchlist, manual portfolio, and preferences remain when you
          disconnect.
        </p>
      </details>
      <Dialog
        title="Disconnect Steam?"
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
      >
        <div className="stack">
          <p>
            This removes the verified Steam connection. Your email login,
            subscription, watchlist, manual portfolio, and preferences stay
            available.
          </p>
          <div className="row">
            <Button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep connected
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void submit(true)}
            >
              {busy ? "Disconnecting…" : "Disconnect Steam"}
            </Button>
          </div>
          {confirm && message && <p role="status">{message}</p>}
          {confirm && reauthenticate && (
            <Link href={`/login?next=${encodeURIComponent(`/${flow}`)}`}>
              Sign in again
            </Link>
          )}
        </div>
      </Dialog>
    </div>
  );
}
