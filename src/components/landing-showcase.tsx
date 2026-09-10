"use client";
import { useRef, useState, type ReactNode } from "react";
const screens = ["01 Terminal", "02 Screener", "03 Asset intel"];
export function LandingShowcase({ children }: { children: ReactNode[] }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <>
      <div className="lp-showcase-heading">
        <div className="lp-heading">
          <span className="lp-label">Production workstations</span>
          <h2>Engineered for serious market surveillance</h2>
        </div>
        <div
          className="lp-screen-tabs"
          role="tablist"
          aria-label="Product preview"
        >
          {screens.map((label, i) => (
            <button
              key={label}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={`preview-tab-${i}`}
              aria-controls={`product-preview-${i}`}
              aria-selected={i === selected}
              tabIndex={i === selected ? 0 : -1}
              onClick={() => setSelected(i)}
              onKeyDown={(e) => {
                const next =
                  e.key === "ArrowRight"
                    ? (i + 1) % 3
                    : e.key === "ArrowLeft"
                      ? (i + 2) % 3
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 2
                          : null;
                if (next !== null) {
                  e.preventDefault();
                  setSelected(next);
                  tabs.current[next]?.focus();
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="lp-screen-frame">
        <div className="lp-windowbar">
          <span>FloatAlpha · {screens[selected].slice(3)}</span>
          <span>DEMO / SYNTHETIC · Fixed example</span>
        </div>
        <div className="showcase-workspace">
          {children.map((child, i) => (
            <section
              key={i}
              id={`product-preview-${i}`}
              className="showcase-panel"
              role="tabpanel"
              aria-labelledby={`preview-tab-${i}`}
              hidden={selected !== i}
              tabIndex={0}
            >
              {child}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
