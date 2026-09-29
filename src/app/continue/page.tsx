import { redirect } from "next/navigation";
import { currentUser } from "@/lib/product/auth";
import { PRIVATE_ROBOTS } from "@/lib/seo";

/*
 * Never prerendered. currentUser() returns null without reaching headers()
 * when auth is unconfigured, which is the case during the build — so this page
 * was statically rendered with the unauthenticated redirect baked in, and
 * would have sent every signed-in visitor to the login screen.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Continue",
  description: "Returning you to FloatAlpha.",
  robots: PRIVATE_ROBOTS,
};

/**
 * Where to send someone once they have authenticated.
 *
 * Google sign-in has to be told its destination before the browser leaves the
 * site, at which point nothing here knows whether an account exists yet. The
 * sign-in and sign-up tabs are not the answer either: Google creates an
 * account for a first-time visitor who clicked "Sign in", and an established
 * user who clicked "Join the Preview" does not need to be set up again. Taking
 * the tab at its word sent returning users back to step 1 of a form they had
 * already completed.
 *
 * So the destination is resolved here instead, once the session exists and the
 * account can be read. This page renders nothing — it is a redirect — so there
 * is no flash of a screen the person was never meant to see.
 */
export default async function Continue() {
  const user = await currentUser();
  // A callback that arrives without a session means authentication did not
  // complete; sending them onward would strand them on a page that bounces.
  if (!user) redirect("/login");
  redirect(user.app.onboarded ? "/terminal" : "/onboarding");
}
