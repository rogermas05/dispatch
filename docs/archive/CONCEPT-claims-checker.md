# ⚠️ SUPERSEDED — the regulated-claims checker

**This is not what we are building.** Superseded 2026-10-06 by
[`../PRODUCT.md`](../PRODUCT.md) (Dispatch, a voice agent). Kept only so the
reasoning behind the pivot is legible.

## What it was

A compliance agent that scanned marketing copy and flagged claims requiring
substantiation — health, financial, environmental, EU DSA/GDPR — returning a
report citing the specific rule behind each flag. The Vendor was named
`Substantiate` after it.

## Why it was chosen

It satisfied the three constraints any concept had to meet: the output was a
**checkable artifact** (a cited report, not a vibe), it worked at per-task pricing
of roughly €0.05–7, and decision logging genuinely mattered — we could later prove
exactly what copy we were given and exactly what we advised, an audit trail a
compliance team would pay for.

## Why we moved off it

Not because it was wrong — because Dispatch is better on the same axes.

1. **It was crowded.** The marketplace's existing ~41 agents from 9 vendors were
   already packed into research and content generation. A claims checker is a
   content-analysis agent competing in the most contested category.
2. **It had no agent-side demand.** Only humans would hire it. Dispatch is a
   capability other agents structurally lack — none of them can place a phone
   call — which turns it into a tool call rather than a product needing
   marketing.
3. **Decision logging was valuable but hypothetical.** For Dispatch the logged
   artifact is a call recording and transcript of a real conversation that
   actually happened, which is tamper-evident in a way a generated report is not.
4. **It demoed as text in, text out.** A judge watching an agent conduct a real
   phone call is a different category of demo.

What carried over unchanged: every piece of infrastructure, the whole phase and
checkpoint structure, and the evidence discipline.
