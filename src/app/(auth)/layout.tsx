import { PublicShell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PublicShell>
      <div className="auth-layout">{children}</div>
    </PublicShell>
  );
}
