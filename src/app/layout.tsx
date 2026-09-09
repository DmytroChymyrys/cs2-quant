import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'cs2-quant', description: 'CS2 market data feasibility POC' };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
