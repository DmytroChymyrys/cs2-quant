"use client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

/**
 * Ending a session, in one place.
 *
 * Sign-out lived only inside Settings and only as one bespoke button. It now
 * also sits in the header, and two copies of "post, then decide what to do
 * about the response" would drift apart, so the behaviour lives here and both
 * call sites render their own chrome around it.
 */
export function useSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const signOut = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same-origin already sends the session cookie; stated so that a
        // future change of endpoint or origin does not silently drop it and
        // leave a sign-out that reports success without ending anything.
        credentials: "same-origin",
        body: "{}",
      });
      if (!response.ok) {
        // Previously a failed sign-out did nothing at all: the button
        // re-enabled and the person stayed signed in with no explanation.
        setFailed(true);
        return;
      }
      /*
       * refresh() before push() so the server components for the destination
       * are re-rendered without the session. Navigating first can paint the
       * cached signed-in shell for a moment on the way out.
       */
      router.refresh();
      router.push("/login");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { signOut, busy, failed };
}

export function SignOutControl({
  children,
  className,
  "aria-label": label,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const { signOut, busy, failed } = useSignOut();
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={failed ? "Could not sign out. Try again." : label}
      data-failed={failed || undefined}
      disabled={busy}
      onClick={signOut}
    >
      {children}
    </button>
  );
}
