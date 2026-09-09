import { DataState, LinkButton, PageHeading } from "./ui";
export function AuthRequired({ feature }: { feature: string }) {
  return (
    <>
      <PageHeading
        title={feature}
        description="Your personal market monitoring workspace."
      />
      <DataState
        state="AUTH_REQUIRED"
        title="Sign in to your workspace"
        description={`Sign in to save and manage your ${feature}. Market observations remain available in the public terminal.`}
        action={
          <LinkButton primary href="/login">
            Sign in to continue
          </LinkButton>
        }
      />
    </>
  );
}
