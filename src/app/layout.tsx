import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "cs2-quant",
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
