import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ title, subtitle, action, className = "", children }: PanelProps) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col rounded-xl border border-line bg-surface ${className}`}>
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 px-4 pb-4">{children}</div>
    </section>
  );
}
