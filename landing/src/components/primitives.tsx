import { useState, type CSSProperties, type ReactNode } from "react";
import { useInView } from "../lib/hooks";

/** Fades and lifts its children into place the first time they enter the viewport. */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${inView ? "is-in" : ""}`} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  );
}

const COPIED_MS = 1600;

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), COPIED_MS);
  };
  return (
    <button type="button" className="text-button" onClick={copy} aria-label={`Copy ${label}`}>
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
}
