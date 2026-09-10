import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import manifest from "../../../config/catalog/upstream-manifest.json";
import { DATASETS, type Dataset } from "./model";
import { hash } from "./normalize";
export { manifest };
export async function loadCatalogSource(
  directory = `.cache/catalog/${manifest.commit}`,
) {
  await mkdir(directory, { recursive: true });
  if (
    manifest.datasets.length !== DATASETS.length ||
    DATASETS.some((d) => !manifest.datasets.some((m) => m.name === d))
  )
    throw new Error("CATALOG_MANIFEST_DATASETS_MISMATCH");
  const result = new Map<Dataset, unknown[]>();
  // Sequential bounded downloads: no uncontrolled fan-out, no mutable main URL.
  for (const entry of manifest.datasets) {
    const file = join(directory, `${entry.name}.json`);
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const response = await fetch(
        `https://raw.githubusercontent.com/ByMykel/CSGO-API/${manifest.commit}/public/api/en/${entry.name}.json`,
        {
          signal: AbortSignal.timeout(60000),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new Error(`CATALOG_SOURCE_HTTP_${response.status}:${entry.name}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("CATALOG_SOURCE_EMPTY_BODY");
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > 100_000_000 || total > entry.bytes) {
            await reader.cancel();
            throw new Error("CATALOG_SOURCE_SIZE_LIMIT");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      bytes = Buffer.concat(chunks);
      if (hash(bytes.toString("utf8")) !== entry.sha256)
        throw new Error(`CATALOG_SOURCE_HASH_MISMATCH:${entry.name}`);
      await writeFile(file, bytes);
    }
    if (
      bytes.length !== entry.bytes ||
      hash(bytes.toString("utf8")) !== entry.sha256
    )
      throw new Error(`CATALOG_SOURCE_HASH_MISMATCH:${entry.name}`);
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== entry.records)
      throw new Error(`CATALOG_SOURCE_COUNT_MISMATCH:${entry.name}`);
    result.set(entry.name as Dataset, parsed);
  }
  return result;
}
