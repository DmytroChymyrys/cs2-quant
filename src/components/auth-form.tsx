"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button, Notice } from "./ui";
import { track } from "@/lib/ga";
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
  returnTo,
}: {
  mode: "login" | "signup" | "forgot" | "reset";
  configuration: {
    configured: boolean;
    email: boolean;
    google: boolean;
    turnstileSiteKey: string | null;
    billingSandbox?: boolean;
  };
  token?: string;
  returnTo?: "/pricing";
}) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [success, setSuccess] = useState(false),
    [captcha, setCaptcha] = useState("");
  const captchaRef = useRef<HTMLDivElement>(null),
    widget = useRef<string | undefined>(undefined);
  const submit = async (path: string, body: object) => {
    setBusy(true);
    setMessage("");
    // Signup intent, measured when the attempt starts rather than when it
    // succeeds: Google leaves the site before any success is observable here.
    // Not a conversion event — billing is inactive and nothing is purchased.
    if (mode === "signup")
      track({
        name: "preview_signup_started",
        params: { method: path === "sign-in/social" ? "google" : "email" },
      });
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
        router.push(
          returnTo ?? (configuration.billingSandbox ? "/pricing" : "/terminal"),
        );
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
    <div
      className={`form-grid auth-fields auth-fields-${mode}`}
      data-success={success}
    >
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
                callbackURL:
                  returnTo ??
                  (configuration.billingSandbox ? "/pricing" : "/onboarding"),
              })
            }
          >
            <svg className="google-mark" aria-hidden="true" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
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
        <div className="auth-success" role="status">
          <span className="auth-success-icon">
            <Check size={20} />
          </span>
          <h2>{mode === "reset" ? "Password updated" : "Check your email"}</h2>
          <p>{message}</p>
          {mode !== "reset" && (
            <div className="auth-next-steps">
              <strong>NEXT STEPS:</strong>
              <p>
                Check your inbox and spam folder. If you signed up with Google,
                use Continue with Google to sign in.
              </p>
            </div>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              className="auth-reenter"
              onClick={() => {
                setSuccess(false);
                setMessage("");
              }}
            >
              Re-enter address
            </button>
          )}
        </div>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget),
              email = String(form.get("email") ?? ""),
              password = String(form.get("password") ?? "");
            if (
              mode === "signup" &&
              password !== String(form.get("confirmPassword") ?? "")
            ) {
              setMessage("Passwords do not match.");
              return;
            }
            if (mode === "signup")
              void submit("sign-up/email", {
                name: email.split("@")[0].slice(0, 100),
                email,
                password,
                callbackURL:
                  returnTo ??
                  (configuration.billingSandbox ? "/pricing" : "/onboarding"),
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
          {mode !== "reset" && (
            <label>
              Email address
              <input
                className="input"
                name="email"
                placeholder="analyst@floatalpha.com"
                type="email"
                autoComplete="email"
                required
                disabled={!ready}
              />
            </label>
          )}
          {mode !== "forgot" && (
            <label>
              <span className="row between">
                {mode === "reset" ? "New password" : "Password"}
                {mode === "login" && (
                  <Link
                    href="/forgot-password"
                    className="cyan password-recovery"
                  >
                    Forgot password?
                  </Link>
                )}
              </span>
              <span className="auth-password">
                <input
                  className="input"
                  name="password"
                  placeholder={
                    mode === "login" ? "••••••••••••" : "Create strong password"
                  }
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  minLength={8}
                  maxLength={128}
                  required
                  disabled={!ready}
                />
                {mode === "login" && (
                  <button
                    type="button"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "HIDE" : "SHOW"}
                  </button>
                )}
              </span>
            </label>
          )}
          {mode === "signup" && (
            <>
              <label>
                Confirm password
                <input
                  className="input"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  required
                  disabled={!ready}
                />
              </label>
              <div className="auth-requirements">
                <strong>PASSWORD REQUIREMENTS:</strong>
                <span>✓ Minimum 8 characters</span>
                <span>✓ Maximum 128 characters</span>
              </div>
              <p className="auth-account-note">
                No credit card, phone, or Steam credentials required.
              </p>
            </>
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
            New to FloatAlpha?{" "}
            <Link href="/signup" className="cyan">
              Create account
            </Link>
          </>
        ) : (
          <Link href="/login" className="cyan">
            Back to sign in
          </Link>
        )}
      </p>
      {mode === "login" && (
        <details className="auth-state-help">
          <summary>
            VIEW ERROR / VERIFICATION HELP <span>▾</span>
          </summary>
          <p>Invalid credentials: check your email and password.</p>
          <p>
            Verification required: complete the security check before signing
            in.
          </p>
        </details>
      )}
    </div>
  );
}
