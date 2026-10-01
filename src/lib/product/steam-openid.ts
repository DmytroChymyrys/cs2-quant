// Steam-only OpenID 2.0 verification. No OAuth tokens, profile API or inventory access.
export const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";
const SELECT = `${NS}/identifier_select`;
const MAX_RESPONSE = 16_384;

export class SteamVerificationError extends Error {}

export function steamCallbackRequestURL(request: Request, baseURL: string) {
  const url = new URL(request.url);
  const canonical = new URL(baseURL);
  const host = request.headers.get("host");
  if (host && host !== canonical.host) throw new SteamVerificationError();
  // Next.js can expose its internal listener origin in Request.url. Reconstruct
  // the public origin only when the actual Host matches our configured origin;
  // never trust arbitrary forwarded-host/proto headers or an assertion URL.
  if (url.origin !== canonical.origin) {
    if (host !== canonical.host) throw new SteamVerificationError();
    url.protocol = canonical.protocol;
    url.host = canonical.host;
    url.port = canonical.port;
  }
  return url;
}

export function steamAuthorizationURL(returnTo: string) {
  const url = new URL(STEAM_OPENID);
  url.search = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": `${new URL(returnTo).origin}/`,
    "openid.identity": SELECT,
    "openid.claimed_id": SELECT,
  }).toString();
  return url.toString();
}

async function steamResponse(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || !response.body) throw new SteamVerificationError();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE) throw new SteamVerificationError();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function verifySteamAssertion(
  requestURL: URL,
  expectedReturnTo: string,
  now = Date.now(),
) {
  const params = requestURL.searchParams;
  const fail = () => {
    throw new SteamVerificationError();
  };
  const required = [
    "op_endpoint",
    "claimed_id",
    "identity",
    "return_to",
    "response_nonce",
    "assoc_handle",
  ];
  // Duplicate parameters can produce different interpretations in the RP and OP.
  for (const key of params.keys()) {
    if (params.getAll(key).length !== 1) fail();
  }
  if (requestURL.toString().length > MAX_RESPONSE) fail();
  if (params.get("openid.ns") !== NS || params.get("openid.mode") !== "id_res")
    fail();
  if (params.get("openid.op_endpoint") !== STEAM_OPENID) fail();
  if (params.get("openid.return_to") !== expectedReturnTo) fail();
  const expected = new URL(expectedReturnTo);
  if (
    requestURL.origin !== expected.origin ||
    requestURL.pathname !== expected.pathname
  )
    fail();
  for (const [key, value] of expected.searchParams) {
    if (params.get(key) !== value) fail();
  }
  const signed = params.get("openid.signed")?.split(",") ?? [];
  if (
    !required.every(
      (field) => signed.includes(field) && params.get(`openid.${field}`),
    )
  )
    fail();
  if (!params.get("openid.sig")) fail();
  const claimed = params.get("openid.claimed_id") ?? "";
  const match = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(
    claimed,
  );
  if (!match || params.get("openid.identity") !== claimed) fail();
  const steamId = match![1];
  const nonce = params.get("openid.response_nonce")!;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z[\x21-\x7e]+$/.test(nonce) ||
    nonce.length > 255
  )
    fail();
  const issued = Date.parse(nonce.slice(0, 20));
  if (
    !Number.isFinite(issued) ||
    issued > now + 60_000 ||
    issued < now - 600_000
  )
    fail();

  // Discover only on Steam's fixed HTTPS identity namespace. Never follow an
  // assertion-supplied endpoint or redirect. Steam serves this small XRDS format.
  const discovery = await steamResponse(
    `https://steamcommunity.com/openid/id/${steamId}`,
  );
  if (/<!DOCTYPE|<!ENTITY|<!--/i.test(discovery)) fail();
  const services = [
    ...discovery.matchAll(/<Service(?:\s[^>]*)?>([\s\S]*?)<\/Service>/g),
  ];
  const discovered = services.some(
    ([, service]) =>
      service.includes(`<Type>${NS}/signon</Type>`) &&
      service.includes(`<URI>${STEAM_OPENID}</URI>`) &&
      !/<(?:\w+:)?LocalID\b/.test(service),
  );
  if (!discovered) fail();

  const body = new URLSearchParams();
  for (const [key, value] of params)
    if (key.startsWith("openid.")) body.append(key, value);
  body.set("openid.mode", "check_authentication");
  const verification = await steamResponse(STEAM_OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const result = new Map<string, string>();
  for (const line of verification.split("\n")) {
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1 || result.has(line.slice(0, colon))) fail();
    result.set(line.slice(0, colon), line.slice(colon + 1));
  }
  if (result.get("ns") !== NS || result.get("is_valid") !== "true") fail();
  return { steamId, nonce };
}
