import { refreshImageHealth } from "./service";

const runtime = globalThis as typeof globalThis & {
  assetImageHealthTimer?: ReturnType<typeof setTimeout>;
};

// Local dev has no external scheduler. Bootstrap and refresh independently of
// requests, without delaying Next's startup or changing production scheduling.
export function startDevelopmentImageHealth() {
  if (runtime.assetImageHealthTimer) return;
  const refresh = async () => {
    let delay = 10 * 60_000;
    try {
      await refreshImageHealth({ invalidateCache: false });
    } catch {
      console.warn(
        "[asset-images] Development health refresh failed. Check the imagery database connection and migration; retrying in one minute.",
      );
      delay = 60_000;
    } finally {
      runtime.assetImageHealthTimer = setTimeout(refresh, delay);
      runtime.assetImageHealthTimer.unref();
    }
  };
  runtime.assetImageHealthTimer = setTimeout(refresh, 1000);
  runtime.assetImageHealthTimer.unref();
}
