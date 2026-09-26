import { AuthNarrative } from "@/components/auth-narrative";
import { AuthForm } from "@/components/auth-form";
import { authConfiguration } from "@/lib/product/auth";
import { PRIVATE_ROBOTS } from "@/lib/seo";
export const metadata = {
  title: "Set a new password",
  description: "Choose a new FloatAlpha password.",
  robots: PRIVATE_ROBOTS,
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return (
    <>
      <AuthNarrative mode="recovery" />
      <div className="auth-column auth-column-reset-password">
        <section className="panel auth-card">
          <span className="eyebrow">FloatAlpha / Account access</span>
          <h1>Choose a new password</h1>
          <p className="muted">
            Use the reset link from your email to update your password.
          </p>
          <AuthForm
            mode="reset"
            configuration={authConfiguration()}
            token={params.token}
          />
        </section>
        <p className="auth-privacy-note">
          Your account credentials are never connected to your Steam inventory.
        </p>
      </div>
    </>
  );
}
