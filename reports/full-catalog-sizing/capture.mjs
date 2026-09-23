/**
 * Bounded catalog capture for the sizing experiment.
 *
 * Isolated from the production runtime: nothing imports this, it writes only to
 * a local directory, and it never touches a database. It issues the same
 * request the collector issues, at the same authorized five-minute cadence,
 * deliberately offset from production's :00/:05 grid so the two never collide.
 *
 * Aborts permanently on the first 429 rather than retrying: being rate limited
 * is the one outcome that would end the experiment for everyone.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const OUT = process.env.OUT ?? "/tmp/catalog-capture";
const SAMPLES = Number(process.env.SAMPLES ?? 7);
const SPACING_MS = 5 * 60 * 1000;
const URL_ITEMS =
  "https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=1";

await mkdir(OUT, { recursive: true });

/** Next instant offset 2.5 minutes from the production five-minute grid. */
function nextOffsetSlot() {
  const now = Date.now();
  const slot = Math.floor(now / SPACING_MS) * SPACING_MS + 150_000;
  return slot > now + 5_000 ? slot : slot + SPACING_MS;
}

for (let i = 0; i < SAMPLES; i++) {
  const due = i === 0 ? nextOffsetSlot() : null;
  if (due) {
    const wait = due - Date.now();
    if (wait > 0) {
      console.log(`waiting ${Math.round(wait / 1000)}s for the offset slot`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const startedAt = new Date();
  const response = await fetch(URL_ITEMS, {
    headers: { "Accept-Encoding": "br" },
    cache: "no-store",
  });
  if (response.status === 429) {
    console.log(JSON.stringify({ sample: i, status: 429, aborted: true }));
    break;
  }
  if (!response.ok) {
    console.log(JSON.stringify({ sample: i, status: response.status }));
    break;
  }
  const body = await response.text();
  const bodyReceivedAt = new Date();
  const bytes = Buffer.byteLength(body);
  const parsed = JSON.parse(body);
  const file = `${OUT}/items-${i}.json`;
  await writeFile(file, body);
  console.log(
    JSON.stringify({
      sample: i,
      startedAt: startedAt.toISOString(),
      bodyReceivedAt: bodyReceivedAt.toISOString(),
      status: response.status,
      contentEncoding: response.headers.get("content-encoding"),
      contentLength: response.headers.get("content-length"),
      rawBytes: bytes,
      gzipBytes: gzipSync(Buffer.from(body)).length,
      rows: parsed.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      file,
    }),
  );
  if (i < SAMPLES - 1)
    await new Promise((r) =>
      setTimeout(r, SPACING_MS - (Date.now() - startedAt.getTime())),
    );
}
