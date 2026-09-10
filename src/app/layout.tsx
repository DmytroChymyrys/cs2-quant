import "./globals.css";
import "./visual-fidelity.css";
import "./craft.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "FloatAlpha",
  description: "CS2 market intelligence grounded in Skinport observations",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
