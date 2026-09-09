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
      <h1>Return to your terminal</h1>
      <p className="muted">
        Follow the assets and market conditions that matter to you.
      </p>
      <AuthForm
        mode="login"
        configuration={authConfiguration()}
        token={params.token}
      />
    </section>
  );
}
