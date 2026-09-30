/**
 * Disposable SteamWebAPI probe client.
 *
 * NOT the production provider adapter. This exists to measure what the paid
 * source actually returns before any of it is designed into the schema.
 *
 * Budget discipline is the point of this file: every call is counted and
 * measured, because the Items allowance is 1,500 per billing period and a
 * careless loop would spend a month of it in a minute.
 *
 * The key is read from the environment and never written to stdout, to a
 * report, or into a saved artifact. Requests fail closed when it is absent.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = "https://www.steamwebapi.com";
const TIMEOUT_MS = 120_000;

export function apiKey() {
  const key = process.env.STEAMWEBAPI_API_KEY?.trim();
  if (!key) throw new Error("STEAMWEBAPI_API_KEY_MISSING");
  return key;
}

/** Redacts the key from anything on its way to a log or an artifact. */
export function scrub(text) {
  const key = process.env.STEAMWEBAPI_API_KEY?.trim();
  if (!key) return text;
  return String(text).split(key).join("<REDACTED_API_KEY>");
}

export const sha256 = (value) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/** Every call this probe makes, for the budget report. */
export const ledger = [];

/**
 * One measured request.
 *
 * `auth` selects where the credential goes. The specification documents a
 * query-parameter scheme for the market endpoints and a header scheme for the
 * screenshot endpoints; the probe tries the header first and records whether
 * the provider actually honours it.
 */
export async function call(path, {
  query = {},
  method = "GET",
  body = null,
  auth = "header",
  bucket = "OTHER",
  label = path,
  keepRaw = false,
} = {}) {
  const key = apiKey();
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  if (auth === "query") url.searchParams.set("key", key);

  const headers = { accept: "application/json" };
  if (auth === "header") headers["X-Api-Key"] = key;
  if (body) headers["content-type"] = "application/json";

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let status = 0, bytes = 0, text = "", error = null, encoding = null;
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    status = response.status;
    encoding = response.headers.get("content-encoding");
    text = await response.text();
    bytes = Buffer.byteLength(text, "utf8");
  } catch (cause) {
    error = String(cause?.name === "AbortError" ? "TIMEOUT" : cause?.message ?? cause);
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - started;

  let json = null, parseError = null;
  if (text) {
    try { json = JSON.parse(text); } catch (cause) { parseError = String(cause?.message ?? cause); }
  }

  const entry = {
    label,
    bucket,
    // The path only — the query string can carry the credential.
    path: url.pathname,
    params: Object.keys(query),
    auth,
    status,
    durationMs,
    bytes,
    contentEncoding: encoding,
    responseSha256: text ? sha256(text) : null,
    error,
    parseError,
    at: new Date(started).toISOString(),
  };
  ledger.push(entry);
  return { ...entry, json, raw: keepRaw ? text : null };
}

/** Writes an artifact with the credential scrubbed, whatever the content. */
export async function saveArtifact(file, content) {
  await mkdir(file.replace(/\/[^/]+$/, ""), { recursive: true });
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  await writeFile(file, scrub(text));
  return { file, bytes: Buffer.byteLength(text, "utf8") };
}

export const summary = () => ({
  calls: ledger.length,
  byBucket: ledger.reduce((acc, e) => {
    acc[e.bucket] = (acc[e.bucket] ?? 0) + 1;
    return acc;
  }, {}),
  bytes: ledger.reduce((n, e) => n + e.bytes, 0),
  statuses: ledger.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {}),
});
