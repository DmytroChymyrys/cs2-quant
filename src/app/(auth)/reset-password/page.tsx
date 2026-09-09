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
  );
}
