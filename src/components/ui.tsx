import { Tooltip } from "./tooltip";
import { metricHelp } from "./metric-help";
export { Tooltip } from "./tooltip";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Database,
  LockKeyhole,
  SearchX,
  Info,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({
  children,
  variant = "",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button className={`btn ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function LinkButton({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link href={href} className={`btn ${primary ? "primary" : ""}`}>
      {children}
    </Link>
  );
}
export function Badge({
  children,
  kind = "",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return (
    <span className={`badge ${kind.toLowerCase()}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
export function SemanticBadge({ state }: { state: string }) {
  return <Badge kind={state}>{state.replaceAll("_", " ")}</Badge>;
}
export function ConfidenceBadge() {
  return (
    <Tooltip text="Price Confidence has no validated methodology yet. No classification or directional prediction is assigned.">
      <Badge>UNAVAILABLE</Badge>
    </Tooltip>
  );
}
export function Panel({
  title,
  note,
  children,
  action,
  className = "",
}: {
  title: string;
  note?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2 className="panel-title">
          <Activity size={13} className="cyan" />
          {title}
        </h2>
        {action ?? <span className="panel-note">{note}</span>}
      </header>
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  children?: ReactNode;
}) {
  const help = metricHelp(label);
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {help && (
          <Tooltip title={help.title} text={help.text}>
            <Info size={11} aria-hidden="true" />
          </Tooltip>
        )}
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note ?? children}</div>
    </div>
  );
}
export type StateKind =
  | "COLLECTING"
  | "INSUFFICIENT_HISTORY"
  | "UNAVAILABLE"
  | "STALE"
  | "SOURCE_DEGRADED"
  | "SOURCE_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "NO_RESULTS"
  | "EMPTY"
  | "AUTH_REQUIRED"
  | "PRO_LOCKED";
export function DataState({
  state,
  title,
  description,
  action,
}: {
  state: StateKind;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  const Icon =
    state === "AUTH_REQUIRED" || state === "PRO_LOCKED"
      ? LockKeyhole
      : state === "COLLECTING" || state === "INSUFFICIENT_HISTORY"
        ? Clock3
        : state === "NO_RESULTS"
          ? SearchX
          : state.includes("ERROR") || state.includes("DEGRADED")
            ? AlertTriangle
            : Database;
  return (
    <div className="empty-state">
      <Icon size={26} />
      <SemanticBadge state={state} />
      <h2>{title ?? state.replaceAll("_", " ")}</h2>
      <p>
        {description ??
          "There is not enough verified data to display this metric. Unavailable values are never replaced with zero."}
      </p>
      {action}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <Info size={15} />
      <span>{children}</span>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Skeleton({
  kind = "panel",
}: {
  kind?: "panel" | "metric" | "table" | "chart" | "rail";
}) {
  return (
    <div
      className={`panel skeleton-grid skeleton-${kind}`}
      role="status"
      aria-label="Loading"
    >
      <span className="skeleton" style={{ width: "45%" }} />
      {Array.from(
        { length: kind === "table" ? 8 : kind === "chart" ? 1 : 3 },
        (_, i) => (
          <span
            key={i}
            className="skeleton"
            style={{
              height: kind === "chart" ? 240 : kind === "table" ? 29 : 17,
              width: i % 2 ? "70%" : "100%",
            }}
          />
        ),
      )}
    </div>
  );
}
