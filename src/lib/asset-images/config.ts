export function areAssetImagesConfiguredEnabled(
  value = process.env.ASSET_IMAGES_ENABLED,
): boolean {
  return value?.trim().toLowerCase() !== "false";
}
export type AssetImageProviderStatus = "HEALTHY" | "DEGRADED" | "DISABLED";
export function effectiveImageState(
  configuredEnabled: boolean,
  status: AssetImageProviderStatus,
) {
  return {
    configuredEnabled,
    status: configuredEnabled
      ? status
      : ("DISABLED" as AssetImageProviderStatus),
    effectiveEnabled: configuredEnabled && status === "HEALTHY",
  };
}
