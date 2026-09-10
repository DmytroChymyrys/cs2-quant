"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./shell";

export function AuthHeader() {
  const login = usePathname() === "/login";
  return (
    <header className="auth-header">
      <Brand />
      <div>
        <span>
          {login ? "Don’t have an account?" : "Already have an account?"}
        </span>
        <Link href={login ? "/signup" : "/login"}>
          {login ? "Create account" : "Sign in"} →
        </Link>
      </div>
    </header>
  );
}
