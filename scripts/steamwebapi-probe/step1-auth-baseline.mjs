import { call, saveArtifact, summary, scrub } from "./client.mjs";

/* Two calls only: does header auth work, and what does the account report. */
const header = await call("/account/me", { auth: "header", bucket: "OTHER", label: "account/me (header auth)" });
console.log(`header auth  -> ${header.status} in ${header.durationMs}ms, ${header.bytes} bytes`);

let query = null;
if (header.status !== 200) {
  query = await call("/account/me", { auth: "query", bucket: "OTHER", label: "account/me (query auth)" });
  console.log(`query auth   -> ${query.status} in ${query.durationMs}ms, ${query.bytes} bytes`);
}

const ok = header.status === 200 ? header : query;
if (ok?.json) {
  console.log("\n=== account payload (structure, values scrubbed of key) ===");
  console.log(scrub(JSON.stringify(ok.json, null, 2)).slice(0, 2600));
}
await saveArtifact("reports/steamwebapi-probe/step1-auth.json", {
  headerAuthStatus: header.status,
  queryAuthStatus: query?.status ?? null,
  account: ok?.json ?? null,
  ledger: summary(),
});
