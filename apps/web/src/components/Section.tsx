import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Fade a section in as it scrolls into view.
 *
 * The page is walked top to bottom during the demo, so each beat should arrive
 * rather than already be sitting there — it cues the room that the subject
 * changed. Runs once per section; re-animating on scroll-back is distracting
 * when someone scrolls up to re-read something.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(true);
    const io = new IntersectionObserver(
      ([e]) => e?.isIntersecting && (setShown(true), io.disconnect()),
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

/**
 * A scroll beat. The page is walked top to bottom during the demo, so each
 * section is one idea with a heading big enough to read from the back of a room.
 */
export function Section({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  const { ref, shown } = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      className="scroll-mt-6 border-t border-line pt-8 transition-all duration-700 ease-out"
      style={{ opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(14px)" }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{eyebrow}</p>
      <h2 className="mt-2 max-w-3xl text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h2>
      {lede && <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-ink-2">{lede}</p>}
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}

export function Card({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-[13px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}
