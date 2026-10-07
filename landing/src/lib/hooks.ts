import { useEffect, useRef, useState, type RefObject } from "react";
import { onFrame } from "./scroll";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_QUERY);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Runs `callback` on every shared animation frame, always with the latest closure. */
export function useFrame(callback: (deltaSeconds: number, nowMs: number) => void): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => onFrame((delta, now) => latest.current(delta, now)), []);
}

/** True once the element has entered the viewport; stays true. */
export function useInView<T extends Element>(margin = "0px 0px -12% 0px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, margin]);
  return [ref, inView];
}
