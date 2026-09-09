"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { Dialog } from "./dialog";
export function MutationButton({
  label,
  endpoint,
  body,
  method = "POST",
  confirm,
}: {
  label: string;
  endpoint: string;
  body?: unknown;
  method?: string;
  confirm?: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [open, setOpen] = useState(false);
  const router = useRouter();
  const perform = async () => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) {
        setMessage(b.message ?? "Request could not be completed.");
        return;
      }
      if (b.url) window.location.assign(b.url);
      else {
        setOpen(false);
        setMessage("Saved.");
        router.refresh();
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        disabled={busy}
        variant={confirm ? "danger" : ""}
        onClick={() => (confirm ? setOpen(true) : void perform())}
      >
        {busy ? "Please wait…" : label}
      </Button>
      {message && (
        <span role="status" className="muted">
          {message}
        </span>
      )}
      {confirm && (
        <Dialog open={open} onClose={() => setOpen(false)} title={label}>
          <div className="stack">
            <p>{confirm}</p>
            <div className="row">
              <Button onClick={() => setOpen(false)}>Keep</Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void perform()}
              >
                Confirm {label.toLowerCase()}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch("/api/auth/sign-out", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (r.ok) {
            router.push("/login");
            router.refresh();
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      Sign out
    </Button>
  );
}
