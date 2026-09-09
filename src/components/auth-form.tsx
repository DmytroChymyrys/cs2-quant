"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Notice } from "./ui";
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
        },
      ) => string;
      reset: (id: string) => void;
    };
  }
}
export function AuthForm({
  mode,
  configuration,
  token,
}: {
  mode: "login" | "signup" | "forgot" | "reset";
  configuration: {
    configured: boolean;
    email: boolean;
    google: boolean;
    turnstileSiteKey: string | null;
  };
  token?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [success, setSuccess] = useState(false),
    [captcha, setCaptcha] = useState("");
  const captchaRef = useRef<HTMLDivElement>(null),
    widget = useRef<string | undefined>(undefined);
  const submit = async (path: string, body: object) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/auth/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(captcha ? { "x-captcha-response": captcha } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(
          response.status === 429
            ? "Too many requests. Wait before trying again."
            : (data.message ?? "Unable to complete this request."),
        );
        return;
      }
      if (data.url && path === "sign-in/social") {
        window.location.assign(data.url);
        return;
      }
      if (mode === "login") {
        router.push("/terminal");
        router.refresh();
        return;
      }
      setSuccess(true);
      setMessage(
        mode === "signup"
          ? "Check your email to verify your account."
          : mode === "forgot"
            ? "If an account is registered, a reset email will arrive shortly."
            : "Your password was updated. You can now sign in.",
      );
    } catch {
      setMessage("The request could not be completed. Please try again.");
    } finally {
      setBusy(false);
      if (widget.current) window.turnstile?.reset(widget.current);
      setCaptcha("");
    }
  };
  const ready = configuration.email && (mode !== "reset" || Boolean(token));
  return (
    <div className="form-grid">
      {!configuration.configured && (
        <Notice>
          Sign-in is not available yet. You can explore the public market views.
        </Notice>
      )}
      {["login", "signup"].includes(mode) && (
        <>
          <Button
            disabled={!configuration.google || busy}
            onClick={() =>
              submit("sign-in/social", {
                provider: "google",
                callbackURL: "/onboarding",
              })
            }
          >
            Continue with Google
          </Button>
          <div className="row">
            <span className="divider spacer" />
            <small>OR CONTINUE WITH EMAIL</small>
            <span className="divider spacer" />
          </div>
        </>
      )}
      {success ? (
        <Notice>{message}</Notice>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget),
              email = String(form.get("email") ?? ""),
              password = String(form.get("password") ?? "");
            if (mode === "signup")
              void submit("sign-up/email", {
                name: form.get("name"),
                email,
                password,
                callbackURL: "/onboarding",
              });
            else if (mode === "login")
              void submit("sign-in/email", { email, password });
            else if (mode === "forgot")
              void submit("request-password-reset", {
                email,
                redirectTo: "/reset-password",
              });
            else
              void submit("reset-password", { token, newPassword: password });
          }}
        >
          {mode === "signup" && (
            <label>
              Name
              <input
                className="input"
                name="name"
                autoComplete="name"
                maxLength={100}
                required
                disabled={!ready}
              />
            </label>
          )}
          {mode !== "reset" && (
            <label>
              Email address
              <input
                className="input"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={!ready}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              {mode === "reset" ? "New password" : "Password"}
              <input
                className="input"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={8}
                maxLength={128}
                required
                disabled={!ready}
              />
            </label>
          )}
          {mode === "login" && (
            <Link href="/forgot-password" className="cyan">
              Forgot password?
            </Link>
          )}
          {configuration.turnstileSiteKey && (
            <>
              <div ref={captchaRef} />
              <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                onReady={() => {
                  if (captchaRef.current && widget.current === undefined)
                    widget.current = window.turnstile?.render(
                      captchaRef.current,
                      {
                        sitekey: configuration.turnstileSiteKey!,
                        theme: "dark",
                        callback: setCaptcha,
                        "expired-callback": () => setCaptcha(""),
                      },
                    );
                }}
              />
            </>
          )}
          {message && (
            <p className="field-error" role="alert">
              {message}
            </p>
          )}
          {!configuration.email && configuration.configured && (
            <Notice>Email authentication is not configured yet.</Notice>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={
              !ready ||
              busy ||
              Boolean(configuration.turnstileSiteKey && !captcha)
            }
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Update password"}
            <ArrowRight size={14} />
          </Button>
        </form>
      )}
      <p className="auth-meta">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="cyan">
              Sign in
            </Link>
          </>
        ) : mode === "login" ? (
          <>
            New to cs2-quant?{" "}
            <Link href="/signup" className="cyan">
              Create an account
            </Link>
          </>
        ) : (
          <Link href="/login" className="cyan">
            Back to sign in
          </Link>
        )}
      </p>
    </div>
  );
}
