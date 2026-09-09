import { currentUser } from "./auth";
import { entitlements } from "./entitlements";
import { ZodError } from "zod";
export class ProductError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function productRequest(
  request: Request,
  action: (context: {
    user: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
    capabilities: Awaited<ReturnType<typeof entitlements>>;
  }) => Promise<unknown>,
) {
  try {
    const user = await currentUser();
    if (!user) throw new ProductError(401, "Sign in to continue.");
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      const expected = process.env.BETTER_AUTH_URL
        ? new URL(process.env.BETTER_AUTH_URL).origin
        : new URL(request.url).origin;
      if (!origin || origin !== expected)
        throw new ProductError(403, "Request origin is not allowed.");
    }
    return Response.json(
      await action({ user, capabilities: await entitlements(user.app.id) }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof ProductError
            ? error.message
            : error instanceof ZodError || error instanceof SyntaxError
              ? "Please check the submitted values."
              : "This feature is temporarily unavailable.",
      },
      {
        status:
          error instanceof ProductError
            ? error.status
            : error instanceof ZodError || error instanceof SyntaxError
              ? 400
              : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
