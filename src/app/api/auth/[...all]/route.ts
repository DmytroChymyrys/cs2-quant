import { authService } from "@/lib/product/auth";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const auth = authService();
    if (!auth)
      return Response.json(
        { message: "Authentication is not available yet." },
        { status: 503 },
      );
    return await auth.handler(request);
  } catch {
    return Response.json(
      { message: "Authentication is temporarily unavailable." },
      { status: 503 },
    );
  }
}
export { handle as GET, handle as POST };
