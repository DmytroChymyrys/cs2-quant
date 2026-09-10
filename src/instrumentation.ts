export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "development"
  ) {
    const { startDevelopmentImageHealth } = await import(
      "./lib/asset-images/development-health"
    );
    startDevelopmentImageHealth();
  }
}
