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
      <h1>Look beneath the price</h1>
      <p className="muted">Create your account. Start with the Free plan.</p>
      <AuthForm
        mode="signup"
        configuration={authConfiguration()}
        token={params.token}
      />
    </section>
  );
}
