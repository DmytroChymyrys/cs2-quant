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
      <AuthNarrative mode="signup" />
      <div className="auth-column auth-column-signup">
        <section className="panel auth-card">
          <span className="eyebrow">FloatAlpha / Account access</span>
          <h1>Create your FloatAlpha account</h1>
          <p className="muted">Start exploring CS2 market intelligence.</p>
          <AuthForm
            mode="signup"
            configuration={authConfiguration()}
            token={params.token}
          />
        </section>
        <p className="auth-privacy-note">
          Low friction onboarding. No credit card, phone, or Steam credentials
          needed.
        </p>
      </div>
    </>
  );
}
