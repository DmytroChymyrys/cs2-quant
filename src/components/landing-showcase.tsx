"use client";
import Image from "next/image";
import { useRef, useState } from "react";
const screens = [
  {
    label: "01 Terminal",
    name: "FloatAlpha terminal",
    image: "/product-previews/terminal-art-full.jpg",
    href: "/terminal",
  },
  {
    label: "02 Screener",
    name: "Quantitative screener",
    image: "/product-previews/screener-art-full.jpg",
    href: "/screener",
  },
  {
    label: "03 Asset intel",
    name: "Asset intelligence",
    image: "/product-previews/asset-art-full.jpg",
    href: "/assets",
  },
];
export function LandingShowcase() {
  const [selected, setSelected] = useState(0);
  const screen = screens[selected];
  const scene = useRef<HTMLAnchorElement>(null);
  const resetMotion = () => {
    for (const name of [
      "--tilt-x",
      "--tilt-y",
      "--pan-x",
      "--pan-y",
      "--light-x",
      "--light-y",
    ])
      scene.current?.style.removeProperty(name);
  };
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
          {screens.map((s, i) => (
            <button
              key={s.label}
              role="tab"
              id={`preview-tab-${i}`}
              aria-controls="product-preview"
              aria-selected={i === selected}
              onClick={() => {
                setSelected(i);
                resetMotion();
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="lp-screen-frame"
        id="product-preview"
        role="tabpanel"
        aria-labelledby={`preview-tab-${selected}`}
      >
        <div className="lp-windowbar">
          <span>
            <i />
            <i />
            <i /> Station: {screen.name}
          </span>
          <span>Concept illustration · Sample metrics · Not live</span>
        </div>
        <a
          href={screen.href}
          aria-label={`Open ${screen.name}`}
          className="lp-screen-image lp-art-scene"
          ref={scene}
          onPointerMove={(event) => {
            if (
              event.pointerType !== "mouse" ||
              !window.matchMedia(
                "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
              ).matches
            )
              return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = Math.max(
              -0.5,
              Math.min(0.5, (event.clientX - bounds.left) / bounds.width - 0.5),
            );
            const y = Math.max(
              -0.5,
              Math.min(0.5, (event.clientY - bounds.top) / bounds.height - 0.5),
            );
            const style = event.currentTarget.style;
            style.setProperty("--tilt-x", `${-y * 3}deg`);
            style.setProperty("--tilt-y", `${x * 3}deg`);
            style.setProperty("--pan-x", `${x * 10}px`);
            style.setProperty("--pan-y", `${y * 10}px`);
            style.setProperty("--light-x", `${(x + 0.5) * 100}%`);
            style.setProperty("--light-y", `${(y + 0.5) * 100}%`);
          }}
          onPointerLeave={resetMotion}
          onPointerCancel={resetMotion}
          onBlur={resetMotion}
        >
          <Image
            unoptimized
            src={screen.image}
            alt={`${screen.name} concept artwork from the approved design: illustrated market curves and sample asset metrics, not live data`}
            width={1408}
            height={768}
            sizes="(max-width:1440px) 100vw, 1376px"
          />
        </a>
      </div>
    </>
  );
}
