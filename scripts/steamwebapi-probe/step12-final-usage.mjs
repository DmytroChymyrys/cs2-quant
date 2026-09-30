import { call, saveArtifact } from "./client.mjs";
const r = await call("/account/me", { bucket: "OTHER", label: "account/me (final)" });
const a = r.json ?? {};
const spend = new Map();
for (const e of a.last100 ?? []) spend.set(e.endpoint, (spend.get(e.endpoint) ?? 0) + (e.credit ?? 0));
const byEndpoint = Object.fromEntries([...spend.entries()].sort((x, y) => y[1] - x[1]));
console.log(`usage: minute=${a.minute} hour=${a.hour} today=${a.today} week=${a.week} month=${a.month}`);
console.log("credits by endpoint (last100):", JSON.stringify(byEndpoint));
console.log("subscription:", a.subscriptionstart, "->", a.subscriptionuntil, "|", a.package);
console.log("provider status:", JSON.stringify(a.steamwebapistatus));
await saveArtifact("docs/evidence/steamwebapi/probe-usage.json", {
  package: a.package,
  subscriptionStart: a.subscriptionstart, subscriptionUntil: a.subscriptionuntil,
  usage: { minute: a.minute, hour: a.hour, today: a.today, week: a.week, month: a.month },
  creditsByEndpoint: byEndpoint,
  providerStatus: a.steamwebapistatus,
  note: "today/month include a small number of calls made by the account owner before this probe began.",
});
