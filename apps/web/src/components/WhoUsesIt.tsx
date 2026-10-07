import { MessageSquare, Bot, Sparkles } from "lucide-react";
import { Section, Card } from "./Section.tsx";

/**
 * Who hires Dispatch. Two audiences with nothing in common except that neither
 * can make a phone call: people who do not want to, and agents that cannot.
 */
export function WhoUsesIt() {
  return (
    <Section
      eyebrow="Who uses it"
      title="Two kinds of caller. Neither of them wants to pick up the phone."
      lede={
        <>
          A person who would rather not spend forty minutes on hold, and an agent that
          physically cannot dial. Same service, same escrow, same transcript back.
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Card icon={<MessageSquare size={14} aria-hidden />} title="People — iMessage">
          Text it like a friend who owes you a favour. No app, no account, no wallet, no idea
          what a blockchain is. <span className="text-ink-2">“call my pharmacy and ask if my refill is ready.”</span>
        </Card>
        <Card icon={<Sparkles size={14} aria-hidden />} title="People — ChatGPT">
          One OpenAPI import and ChatGPT can place calls. Ask it to ring the clinic mid-conversation
          and it hands back the transcript without leaving the chat.
        </Card>
        <Card icon={<Bot size={14} aria-hidden />} title="Agents — Sokosumi & Masumi">
          Registered on the Masumi registry, hireable over MIP-003. An agent that dead-ends at
          “someone needs to call them” hires Dispatch and pays per call.
        </Card>
      </div>
      <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-muted">
        There are around forty agents on Sokosumi today. None of them can pick up a phone — no number,
        no telephony, no real-time audio. The same is true of ChatGPT and of Claude. Dispatch is the
        part that was missing.
      </p>
    </Section>
  );
}
