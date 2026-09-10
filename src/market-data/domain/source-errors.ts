import type { MarketDataProvider } from "./provider";
export type SourceErrorCode =
  | "SOURCE_RATE_LIMITED"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_TIMEOUT"
  | "SOURCE_INVALID_RESPONSE"
  | "SOURCE_AUTH_FAILED"
  | "TRANSFORM_VALIDATION_FAILED"
  | "ASSET_MAPPING_MISSING"
  | "SOURCE_DISABLED"
  | "SOURCE_MAPPING_PENDING";
export class MarketSourceError extends Error {
  constructor(
    public readonly provider: MarketDataProvider,
    public readonly sourceCode: SourceErrorCode,
    public readonly endpoint: string,
    public readonly httpStatus: number | null = null,
  ) {
    super(`${provider}: ${sourceCode}`);
  }
}
