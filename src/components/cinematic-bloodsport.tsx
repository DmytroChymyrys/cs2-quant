"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import styles from "./cinematic-bloodsport.module.css";

/** An opt-in presentation experiment. The server always renders the approved image. */
export function CinematicBloodsport({
  className,
  cinematic = false,
}: {
  className?: string;
  cinematic?: boolean;
}) {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(
      window.location.hostname,
    );
    const comparison = local
      ? new URLSearchParams(window.location.search).get("hero")
      : null;
    const enabled =
      comparison === "static" ? false : comparison === "cinematic" || cinematic;
    const quiet = window.matchMedia(
      "(prefers-reduced-motion: reduce), (max-width: 767px)",
    );
    const saveData = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection?.saveData;
    if (!enabled || quiet.matches || saveData || !stage.animate) return;

    let stopped = false;
    let frame = 0;
    const animations: Animation[] = [];
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      animations.forEach((animation) => animation.cancel());
      stage.dataset.cinematicState = "settled";
    };
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    const onPreference = () => {
      if (quiet.matches) stop();
    };
    quiet.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);

    const reveal = () => {
      if (stopped || quiet.matches || document.hidden) return;
      const plate = stage.querySelector<HTMLElement>("[data-cinematic-plate]");
      const light = stage.querySelector<HTMLElement>("[data-cinematic-light]");
      if (!plate || !light) return;
      stage.dataset.cinematicState = "revealing";
      const play = (
        element: Element,
        frames: Keyframe[],
        options: KeyframeAnimationOptions,
      ) => {
        const animation = element.animate(frames, options);
        animations.push(animation);
      };

      // Start AND finish at the approved frame. No held transform/filter or idle loop.
      play(
        plate,
        [
          { transform: "none", filter: "brightness(1)", offset: 0 },
          {
            transform: "scale(1.008) rotate(-0.12deg)",
            filter: "brightness(.94)",
            offset: 0.2,
          },
          {
            transform: "scale(1.018) rotate(-0.25deg)",
            filter: "brightness(1.025)",
            offset: 0.48,
          },
          { transform: "none", filter: "brightness(1)", offset: 1 },
        ],
        { duration: 2100, easing: "ease-in-out" },
      );
      play(
        light,
        [
          { backgroundPosition: "150% 0", opacity: 0, offset: 0 },
          { backgroundPosition: "120% 0", opacity: 0.65, offset: 0.2 },
          { backgroundPosition: "-20% 0", opacity: 0.5, offset: 0.8 },
          { backgroundPosition: "-50% 0", opacity: 0, offset: 1 },
        ],
        { duration: 1400, delay: 180, easing: "ease-in-out" },
      );

      // Real chart geometry and values stay intact; only their presentation changes.
      const figure = stage.closest("figure");
      const chart = figure?.querySelector("[data-cinematic-chart]");
      if (chart)
        play(
          chart,
          [
            { opacity: 1, clipPath: "inset(0 0 0 0)", offset: 0 },
            { opacity: 0.45, clipPath: "inset(0 0 0 0)", offset: 0.1 },
            { opacity: 1, clipPath: "inset(0 0 0 0)", offset: 1 },
          ],
          { duration: 650, delay: 800 },
        );
      figure
        ?.querySelectorAll("[data-cinematic-metric]")
        .forEach((metric, index) => {
          play(metric, [{ opacity: 1 }, { opacity: 0.7 }, { opacity: 1 }], {
            duration: 350,
            delay: 950 + index * 150,
            easing: "ease-in-out",
          });
        });
      void Promise.allSettled(
        animations.map((animation) => animation.finished),
      ).then(stop);
    };

    const image = stage.querySelector("img");
    // Slow/failed image loading keeps the ordinary static fallback; no delayed intro.
    const started = performance.now();
    void image
      ?.decode()
      .then(() => {
        if (stopped || performance.now() - started > 2500) return;
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(reveal);
        });
      })
      .catch(() => {});

    return () => {
      stop();
      quiet.removeEventListener("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cinematic]);

  return (
    <div ref={stageRef} className={styles.stage} data-cinematic-state="static">
      <div className={styles.plate} data-cinematic-plate>
        <Image
          className={className}
          src="/landing-artwork/ak47-bloodsport-cinematic.png"
          alt="AK-47 Bloodsport concept artwork above a perspective market-data grid"
          width={1376}
          height={768}
          sizes="(max-width: 767px) 90vw, (max-width: 1023px) 80vw, 52vw"
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
        <div className={styles.light} data-cinematic-light aria-hidden="true" />
      </div>
    </div>
  );
}
