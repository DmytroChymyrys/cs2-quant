import { AuthNarrative } from "@/components/auth-narrative";
import { AuthForm } from "@/components/auth-form";
import { authConfiguration } from "@/lib/product/auth";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return (
    <>
      <AuthNarrative mode="login" />
      <div className="auth-column auth-column-login">
        <section className="panel auth-card">
          <span className="eyebrow">FloatAlpha / Account access</span>
          <h1>Welcome back</h1>
          <p className="muted">Sign in to your FloatAlpha account.</p>
          <AuthForm
            mode="login"
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
