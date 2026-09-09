import { Skeleton } from "@/components/ui";
export default function Loading() {
  return (
    <>
      <div className="metric-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} kind="metric" />
        ))}
      </div>
      <div className="terminal-grid">
        <Skeleton kind="chart" />
        <Skeleton kind="rail" />
      </div>
      <Skeleton kind="table" />
    </>
  );
}
