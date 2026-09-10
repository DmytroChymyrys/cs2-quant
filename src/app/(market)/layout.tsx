import { AssetImagesProvider } from "@/components/asset-image";
import { assetImageState } from "@/lib/asset-images/service";
import "../asset-images.css";
import { AppShell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const images = await assetImageState();
  return (
    <AssetImagesProvider
      configuredEnabled={images.configuredEnabled}
      initiallyEnabled={images.effectiveEnabled}
    >
      <AppShell>{children}</AppShell>
    </AssetImagesProvider>
  );
}
