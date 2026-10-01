"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "./ui";

/**
 * Explicit "Connect Google".
 *
 * A FloatAlpha account may hold SEVERAL Google identities -- a personal address
 * and a work one, say -- so this is a list with an add control, not a single
 * on/off switch. Each identity signs in to the same account.
 */

type Connection = { id: string; subject: string; connectedAt: string };

const outcomes: Record<string, string> = {
  connected: "Google is connected to this FloatAlpha account.",
  cancelled: "Connecting Google was cancelled. Nothing changed.",
  failed:
    "Google could not be connected. Your FloatAlpha account is unchanged. Please try again.",
  conflict:
    "That Google account is already connected to a different FloatAlpha account. It has not been moved. Sign in to that account and disconnect it there first.",
};

/** Google's subject is a long opaque number; the tail distinguishes two of them. */
const label = (subject: string) => `····${subject.slice(-6)}`;

export function GoogleConnections({
  connections,
  enabled,
  outcome,
}: {
  connections: Connection[];
  enabled: boolean;
  outcome?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reauthenticate, setReauthenticate] = useState(false);
  const status = message || (outcome ? (outcomes[outcome] ?? "") : "");

  async function submit(disconnectId?: string) {
    setBusy(true);
    setMessage("");
    setReauthenticate(false);
    try {
      const response = await fetch(
        disconnectId ? "/api/auth/unlink-account" : "/api/auth/google/link",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            disconnectId ? { accountId: disconnectId } : { flow: "settings" },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || result.code === "SESSION_NOT_FRESH") {
          setReauthenticate(true);
          setMessage(
            "Please sign in again before changing your connected accounts.",
          );
        } else
          setMessage(
            result.message ??
              "The connection could not be updated. Please try again. Your account remains available.",
          );
        return;
      }
      if (disconnectId) {
        setMessage(
          "Google disconnected. Your FloatAlpha account and saved data are unchanged.",
        );
        router.refresh();
        return;
      }
      if (typeof result.url !== "string") throw Error();
      const target = new URL(result.url, window.location.origin);
      // Only ever Google's own authorization endpoint.
      if (target.origin !== "https://accounts.google.com") throw Error();
      window.location.assign(target.toString());
    } catch {
      setMessage(
        "Google could not be reached. You can continue without connecting.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="stack"
      data-google-connections={connections.length ? "connected" : "not-connected"}
    >
      <div className="row between">
        <h2>Google</h2>
        <span className="eyebrow">
          {connections.length
            ? `${connections.length} connected`
            : "Not connected"}
        </span>
      </div>
      {connections.length ? (
        <>
          <p>
            {connections.length === 1
              ? "This Google account can sign in to FloatAlpha."
              : "Each of these Google accounts can sign in to FloatAlpha."}
          </p>
          {connections.map((connection) => (
            <div className="account-fact" key={connection.id}>
              <span className="mono">Google {label(connection.subject)}</span>
              <span className="muted">
                Connected {connection.connectedAt.slice(0, 10)} · UTC
              </span>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void submit(connection.id)}
              >
                Disconnect
              </Button>
            </div>
          ))}
        </>
      ) : (
        <p>
          Connect a Google account so you can sign in with it. This does not
          change your existing sign-in methods.
        </p>
      )}
      <p className="muted">
        You will be asked to choose a Google account every time, so you can
        connect one you are not currently signed in to. We store the Google
        account identifier and the connection date.
      </p>
      <div className="row">
        <Button
          type="button"
          disabled={!enabled || busy}
          onClick={() => void submit()}
        >
          {busy
            ? "Opening Google…"
            : connections.length
              ? "Connect another Google account"
              : "Connect Google"}
        </Button>
      </div>
      {!enabled && !connections.length && (
        <Notice>
          Connecting Google is not available right now. Continue with your
          FloatAlpha account.
        </Notice>
      )}
      {status && <p role="status">{status}</p>}
      {reauthenticate && (
        <Link className="cyan" href="/login?next=%2Fsettings">
          Sign in again
        </Link>
      )}
      <details>
        <summary>Connection privacy and removal</summary>
        <p>
          Connecting proves you control that Google account. It does not change
          your plan or share your market activity, and your other sign-in
          methods remain available. A Google account can belong to only one
          FloatAlpha account; if it is already connected elsewhere we refuse
          rather than move it.
        </p>
        <p>
          Disconnecting removes the stored identifier and connection date. We
          keep at least one way for you to sign in, so the last remaining method
          cannot be removed. Your watchlist, manual portfolio, and preferences
          are unaffected.
        </p>
      </details>
    </div>
  );
}
