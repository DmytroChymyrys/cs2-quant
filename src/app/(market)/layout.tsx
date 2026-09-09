import { AppShell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
