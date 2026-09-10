import { createHash } from "node:crypto";
import { z } from "zod";
import { sourceConfig } from "../../../lib/config";
import {
  itemsSchema,
  historiesSchema,
  parseSourceJson,
} from "./skinport.schemas";
import {
  MarketSourceError,
  type SourceErrorCode,
} from "../../domain/source-errors";
const errorCodes: Record<string, SourceErrorCode> = {
  RATE_LIMITED: "SOURCE_RATE_LIMITED",
  HTTP_ERROR: "SOURCE_UNAVAILABLE",
  TIMEOUT: "SOURCE_TIMEOUT",
  MALFORMED_JSON: "SOURCE_INVALID_RESPONSE",
  INVALID_SCHEMA: "SOURCE_INVALID_RESPONSE",
  NETWORK_ERROR: "SOURCE_UNAVAILABLE",
};
export class SourceError extends MarketSourceError {
  constructor(
    public code: string,
    endpoint: string,
    httpStatus: number | null = null,
    public details?: { validationIssues: { path: string; code: string }[] },
  ) {
    super(
      "SKINPORT_DIRECT",
      httpStatus === 401 || httpStatus === 403
        ? "SOURCE_AUTH_FAILED"
        : (errorCodes[code] ?? "SOURCE_UNAVAILABLE"),
      endpoint,
      httpStatus,
    );
    this.message = `${endpoint}: ${code}`;
  }
}
export function skinportClient(fetcher: typeof fetch = fetch) {
  const config = sourceConfig();
  async function get<T>(path: string, schema: z.ZodType<T>) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.SKINPORT_REQUEST_TIMEOUT_MS,
    );
    let status: number | null = null;
    const startedAt = new Date();
    try {
      const params = new URLSearchParams({
        app_id: "730",
        currency: config.SKINPORT_CURRENCY,
      });
      if (path === "items") params.set("tradable", "1");
      const response = await fetcher(
        `https://api.skinport.com/v1/${path}?${params}`,
        {
          headers: { "Accept-Encoding": "br" },
          signal: controller.signal,
          cache: "no-store",
        },
      );
      status = response.status;
      if (!response.ok)
        throw new SourceError(
          status === 429 ? "RATE_LIMITED" : "HTTP_ERROR",
          path,
          status,
        );
      const body = await response.text();
      const bodyReceivedAt = new Date();
      const bodySha256 = createHash("sha256").update(body).digest("hex");
      const responseBytes = Buffer.byteLength(body);
      let raw: unknown;
      try {
        raw = parseSourceJson(body);
      } catch {
        throw new SourceError(
          controller.signal.aborted ? "TIMEOUT" : "MALFORMED_JSON",
          path,
          status,
        );
      }
      const result = schema.safeParse(raw);
      if (!result.success)
        throw new SourceError("INVALID_SCHEMA", path, status, {
          validationIssues: result.error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.map(String).join("."),
            code: issue.code,
          })),
        });
      return {
        data: result.data,
        status,
        startedAt,
        finishedAt: new Date(),
        bodyReceivedAt,
        bodySha256,
        responseBytes,
      };
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError(
        controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
        path,
        status,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    items: () => get("items", itemsSchema),
    history: () => get("sales/history", historiesSchema),
  };
}
