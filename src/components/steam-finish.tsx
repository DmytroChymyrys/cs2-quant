"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Completes "I already have a FloatAlpha account" after they have signed in.
 *
 * The verified Steam identity waited in a server-side single-use record bound
 * to this browser by a signed cookie; it was never carried in the URL. The
 * endpoint requires a FRESH session, so signing in a moment ago is what
 * authorises the link — a long-lived background session cannot absorb it.
 */
export function SteamFinish() {
  const [state, setState] = useState<"working" | "failed">("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    // Once per mount: a retry would find the record already consumed.
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/steam/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const body = await response.json();
        if (!response.ok || !body?.url) {
          setState("failed");
          setMessage(
            body?.code === "ALREADY_CONNECTED"
              ? "This account already has a Steam identity connected."
              : body?.code === "STEAM_ALREADY_LINKED"
                ? "That Steam identity belongs to another FloatAlpha account."
                : "That Steam verification has expired. Start again from sign in.",
          );
          return;
        }
        window.location.href = body.url;
      } catch {
        setState("failed");
        setMessage("Steam could not be connected. Try again from Settings.");
      }
    })();
  }, []);

  return (
    <section className="panel auth-card">
      <span className="eyebrow">FloatAlpha / Connecting Steam</span>
      <h1>{state === "working" ? "Connecting Steam" : "Steam not connected"}</h1>
      <p className="muted">
        {state === "working"
          ? "Linking your verified Steam identity to this account."
          : message}
      </p>
      {state === "failed" && (
        <p className="muted">
          Your FloatAlpha account is unchanged and you are signed in. Steam can
          be connected from <a href="/settings#connected-accounts">Settings</a>.
        </p>
      )}
    </section>
  );
}
