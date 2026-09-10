import { OPS_SECTIONS, type OpsSection } from "./config";
export function opsInput(params: URLSearchParams) {
  const rawDays = Number(params.get("days") ?? 7);
  const rawPage = Number(params.get("page") ?? 1);
  return {
    days: [1, 7, 30].includes(rawDays) ? rawDays : 7,
    page: Number.isInteger(rawPage) ? Math.max(1, Math.min(400, rawPage)) : 1,
    search: (params.get("q") ?? "").trim().slice(0, 100),
  };
}
export function opsSection(value = "overview"): OpsSection | null {
  return OPS_SECTIONS.includes(value as OpsSection)
    ? (value as OpsSection)
    : null;
}
