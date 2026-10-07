"use client";

import Form from "next/form";
import { useState, type ReactNode } from "react";
import { SignupGate } from "./signup-gate";

/**
 * The filter form, with the guest action gate around it.
 *
 * ## Why the form and not the button
 *
 * A form submits on Enter in any text input, not only on clicking the submit
 * button. Intercepting the click would gate the button and leave the keyboard
 * path open, which is the kind of half-measure that looks correct in a
 * screenshot and is wrong in use. `onSubmit` is the one place both arrive.
 *
 * Next's `<Form>` documents exactly this: "calling event.preventDefault() will
 * override `<Form>` behavior such as navigating to the specified URL". So the
 * guest's screen is never executed — no navigation, no new search params, no
 * server render of a screen they cannot have.
 *
 * ## The button stays live
 *
 * It is not disabled and carries no lock iconography. A disabled control tells
 * a visitor they are not permitted; this one tells them what they would get.
 * The gate appears BECAUSE they acted, so it reads as an answer rather than an
 * interruption, and nothing is gated until they do.
 *
 * ## Authenticated is a different tree
 *
 * With `authenticated`, no handler is attached at all — not a handler that
 * checks a flag and returns. Submission is then the plain `<Form>` behaviour it
 * was before this component existed, with nothing to go wrong in between.
 */
export function ScreenForm({
  action,
  authenticated,
  surface,
  children,
}: {
  action: string;
  authenticated: boolean;
  /** GA4 surface label for the action gate, e.g. `screener-run`. */
  surface: string;
  children: ReactNode;
}) {
  const [attempted, setAttempted] = useState(false);

  if (authenticated)
    return (
      <Form action={action} className="filters" scroll={false}>
        {children}
      </Form>
    );

  return (
    <>
      <Form
        action={action}
        className="filters"
        scroll={false}
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
        }}
      >
        {children}
      </Form>
      {attempted && (
        <SignupGate
          compact
          surface={surface}
          title="Unlock the full Screener"
          description="Create a free account to run custom screens, use the complete tracked universe and access the full research workspace."
        />
      )}
    </>
  );
}
