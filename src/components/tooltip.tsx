"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function Tooltip({
  children,
  text,
  title = "Metric explanation",
}: {
  children: ReactNode;
  text: string;
  title?: string;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const close = () => {
    clearTimeout(timer.current);
    setPosition(null);
  };
  const show = () => {
    clearTimeout(timer.current);
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(320, window.innerWidth - 24);
    setPosition({
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
      top: r.top > 230 ? r.top - 8 : r.bottom + 8,
      above: r.top > 230,
    });
  };
  useEffect(() => {
    if (!position) return;
    const dismiss = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPosition(null);
      }
    };
    const hide = () => setPosition(null);
    document.addEventListener("keydown", dismiss, true);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("keydown", dismiss, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [position]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="metric-tooltip">
      <button
        ref={trigger}
        type="button"
        className="metric-help-trigger"
        aria-label={`About ${title}`}
        aria-describedby={position ? id : undefined}
        onFocus={show}
        onBlur={close}
        onPointerEnter={show}
        onPointerLeave={() => {
          if (document.activeElement !== trigger.current)
            timer.current = setTimeout(close, 150);
        }}
        onClick={show}
      >
        {children}
      </button>
      {position &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="metric-help-popover"
            style={{
              left: position.left,
              top: position.top,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={close}
          >
            <strong>{title}</strong>
            <span>{text}</span>
          </span>,
          document.body,
        )}
    </span>
  );
}
