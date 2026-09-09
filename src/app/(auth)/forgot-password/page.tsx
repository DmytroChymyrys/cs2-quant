import { AuthForm } from "@/components/auth-form";
import { authConfiguration } from "@/lib/product/auth";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  return (
    <section className="panel auth-card">
      <span className="eyebrow">cs2-quant / Account access</span>
      <h1>Reset your password</h1>
      <p className="muted">
        Enter your email to request a password reset link.
      </p>
      <AuthForm
        mode="forgot"
        configuration={authConfiguration()}
        token={params.token}
      />
    </section>
  );
}
