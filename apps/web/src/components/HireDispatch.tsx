import { MessageSquare, Terminal, FileJson, BookOpen } from "lucide-react";
import { Panel } from "./Panel.tsx";

const API = import.meta.env.VITE_AGENT_API_URL ?? "https://agent-api-production-4ce3.up.railway.app";
const IMESSAGE_HANDLE = import.meta.env.VITE_IMESSAGE_HANDLE ?? "aman@safirahiring.com";

/**
 * How to actually hire Dispatch — the two audiences, side by side.
 *
 * A person texts it; an agent posts to it. Showing both together is the point:
 * the same agent, the same escrow, the same transcript back, reached either by
 * someone who has never heard of Cardano or by software that cannot hold a card.
 */
export function HireDispatch() {
  return (
    <Panel
      title="Hire Dispatch"
      subtitle="A person texts it. An agent posts to it. Same agent, same escrow, same transcript back."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Humans */}
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <MessageSquare size={14} aria-hidden /> If you're a person
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Text it like you'd text a friend who owes you a favour. No app, no account, no wallet.
          </p>
          <a
            href={`imessage://${IMESSAGE_HANDLE}`}
            className="mt-2.5 inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-ink hover:border-ink-2"
          >
            {IMESSAGE_HANDLE}
          </a>
          <p className="mt-2 text-xs text-muted">
            <span className="text-ink-2">“call my pharmacy and ask if my refill is ready”</span> — it quotes the
            price, locks it in escrow, dials, and texts you what was said.
          </p>
        </div>

        {/* Agents */}
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Terminal size={14} aria-hidden /> If you're an agent
          </div>
          <p className="mt-1.5 text-xs text-muted">
            One POST. Dispatch handles the escrow; poll for the transcript.
          </p>
          <pre className="mt-2.5 overflow-x-auto rounded-md border border-line bg-black/20 p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
{`POST ${API}/v1/call
{
  "to": "+14155550123",
  "objective": "Ask if order 4417 shipped.",
  "authorization": "Information only.",
  "on_behalf_of": "Aman"
}`}
          </pre>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Link href={`${API}/openapi.json`} icon={<FileJson size={12} aria-hidden />}>
              openapi.json
            </Link>
            <Link href={`${API}/llms.txt`} icon={<BookOpen size={12} aria-hidden />}>
              llms.txt
            </Link>
            <Link href={`${API}/input_schema`} icon={<FileJson size={12} aria-hidden />}>
              MIP-003 schema
            </Link>
          </div>
          <p className="mt-2 text-xs text-muted">
            Import <span className="font-mono text-ink-2">openapi.json</span> as a ChatGPT Action and it can
            place calls. Masumi-native agents can hire it over MIP-003 and fund the escrow themselves.
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        Priced per call from the expected length — a quick question costs less than one that may sit on hold.
        If a call doesn't complete, no result hash is submitted and the escrow refunds automatically.
      </p>
    </Panel>
  );
}

function Link({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[11px] text-ink-2 hover:border-ink-2 hover:text-ink"
    >
      {icon}
      {children}
    </a>
  );
}
