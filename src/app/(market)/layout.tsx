import { AssetImagesProvider } from "@/components/asset-image";
import { assetImageState } from "@/lib/asset-images/service";
import "../asset-images.css";
import "./market-presentation.css";
import { AppShell } from "@/components/shell";
import { currentUser } from "@/lib/product/auth";
export const dynamic = "force-dynamic";
export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const images = await assetImageState();
  // Read here rather than in the shell: the shell is a client component, and
  // this keeps the acquisition CTAs a server-rendered decision.
  const user = await currentUser();
  return (
    <AssetImagesProvider
      configuredEnabled={images.configuredEnabled}
      initiallyEnabled={images.effectiveEnabled}
    >
      <AppShell authenticated={Boolean(user)}>{children}</AppShell>
    </AssetImagesProvider>
  );
}
