import { Bot, MessageSquare, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { Panel } from "./Panel.tsx";

const CALLERS = [
  {
    icon: <MessageSquare size={13} aria-hidden />,
    who: "People, over iMessage",
    what: "Text it like a friend who owes you a favour. No app, no account, no wallet.",
  },
  {
    icon: <Sparkles size={13} aria-hidden />,
    who: "People, inside ChatGPT",
    what: "One OpenAPI import and it can place calls mid-conversation.",
  },
  {
    icon: <Bot size={13} aria-hidden />,
    who: "Agents, over Masumi",
    what: "Registered and hireable via MIP-003. They pay per call from their own wallet.",
  },
];

export function WhoHires() {
  return (
    <Panel title="Who hires Dispatch" subtitle="Two audiences. Neither of them can make the call themselves.">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2">
        {CALLERS.map((c) => (
          <div key={c.who} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <span className="text-muted">{c.icon}</span>
              {c.who}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{c.what}</p>
          </div>
        ))}
        <p className="text-[11.5px] leading-snug text-ink-2">
          About forty agents are on Sokosumi today. None of them can pick up a phone — no number, no
          telephony, no real-time audio. Same for ChatGPT and Claude.
        </p>
      </motion.div>
    </Panel>
  );
}
