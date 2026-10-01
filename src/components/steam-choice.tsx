"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

/**
 * What to do with a verified Steam identity that is not linked to anything.
 *
 * Deliberately a question rather than an answer. A SteamID can belong to only
 * one FloatAlpha account, so creating one here would consume it — and someone
 * who already has a Google or email account would then be permanently unable
 * to connect Steam to it. Nothing about the verified identity tells us which
 * case this is, and guessing from a name or a browser session is exactly the
 * inference that must never happen.
 *
 * Both options are given equal weight. Existing-account recovery as a small
 * secondary link is how people end up with a duplicate account they did not
 * want.
 */
export function SteamChoice() {
  const router = useRouter();
  const [busy, setBusy] = useState<"new" | "existing" | null>(null);
  const [message, setMessage] = useState("");

  const createAccount = async () => {
    setBusy("new");
    setMessage("");
    try {
      const response = await fetch("/api/auth/steam/create-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok || !body?.url) throw Error();
      // A full navigation, so the new session cookie is used for the next
      // request rather than a cached client router entry.
      window.location.href = body.url;
    } catch {
      setBusy(null);
      setMessage(
        "That Steam verification has expired. Start again from sign in.",
      );
    }
  };

  return (
    <section className="panel auth-card">
      <span className="eyebrow">FloatAlpha / Steam verified</span>
      <h1>Steam verified</h1>
      <p className="muted">
        Your Steam identity has been verified. Choose how you&rsquo;d like to
        continue.
      </p>
      <div className="stack">
        <Button
          type="button"
          variant="primary"
          disabled={busy !== null}
          onClick={() => {
            setBusy("existing");
            router.push("/login?next=/steam/finish");
          }}
        >
          I already have a FloatAlpha account
        </Button>
        <p className="muted">
          Sign in with Google or email and we&rsquo;ll connect Steam to that
          account.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={createAccount}
        >
          Continue as a new account
        </Button>
        <p className="muted">
          Create a new FloatAlpha account using your Steam identity.
        </p>
      </div>
      {message && <p className="notice">{message}</p>}
    </section>
  );
}
