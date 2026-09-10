import Link from "next/link";
import { AuthHeader } from "@/components/auth-header";
import "./auth-fidelity.css";
export const dynamic = "force-dynamic";
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-screen">
      <AuthHeader />
      <main id="main-content" className="auth-layout">
        {children}
      </main>
      <footer className="auth-footer">
        <span>FloatAlpha · CS2 market intelligence</span>
        <Link href="/#data">Data & methodology</Link>
      </footer>
    </div>
  );
}
