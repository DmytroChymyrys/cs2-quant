import Link from "next/link";
import { Notice } from "./ui";

/**
 * What to do after a social sign-in that could not be completed.
 *
 * `account_not_linked` is the one worth explaining properly. It means Google
 * authenticated somebody, and an account already exists under that email
 * address, but this Google identity has never been connected to it. We
 * deliberately do not link on a matching address: the address is a claim a
 * provider makes, not proof that the person at the keyboard owns the
 * FloatAlpha account. So the wording says what happened and what to do, and
 * never suggests that the matching address established anything.
 */

const PROBLEMS: Record<string, { title: string; body: React.ReactNode }> = {
  account_not_linked: {
    title: "This Google account isn’t connected to a FloatAlpha account",
    body: (
      <>
        Sign in using one of your existing methods, then go to{" "}
        <strong>Settings → Connected accounts → Connect Google</strong> to add
        it. After that you can sign in with Google any time.
      </>
    ),
  },
  signup_disabled: {
    title: "Sign-up is not available through this provider",
    body: <>Create an account with an email address, then connect Google from Settings.</>,
  },
  email_not_found: {
    title: "Google did not share an email address",
    body: (
      <>
        Sign in with an email address and password instead, or connect Google
        later from Settings.
      </>
    ),
  },
};

export function SignInProblem({ error }: { error?: string }) {
  if (!error) return null;
  const problem = PROBLEMS[error];
  return (
    <Notice error>
      <strong>{problem?.title ?? "Sign-in could not be completed"}</strong>
      <p>
        {problem?.body ?? (
          <>
            Nothing has changed on your account. Please try again, or sign in
            with another method.
          </>
        )}
      </p>
      {error === "account_not_linked" && (
        <p>
          <Link className="cyan" href="/forgot-password">
            Forgotten your password?
          </Link>
        </p>
      )}
    </Notice>
  );
}
