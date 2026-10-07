import { AssetImagesProvider } from "@/components/asset-image";
import { assetImageState } from "@/lib/asset-images/service";
import "../asset-images.css";
import "./market-presentation.css";
import { AppShell } from "@/components/shell";
import { currentUser } from "@/lib/product/auth";
import { SignupConversion } from "@/components/signup-conversion";
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
      {/* Claimed once per account in the database, so rendering it from the
          shared shell cannot double count however the visitor arrived. */}
      <SignupConversion />
      <AppShell authenticated={Boolean(user)}>{children}</AppShell>
    </AssetImagesProvider>
  );
}
