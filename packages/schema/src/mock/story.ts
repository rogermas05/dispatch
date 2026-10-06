// Demo story (docs/PRODUCT.md §6): the consumer call that opens the pitch, then the
// agent-to-agent hire that is the main event. Every name and number is fictional;
// 555-01xx numbers are reserved for fiction. The feed marks all of it as mock.
import type { CallOutcome, Hirer, JobInput, Party } from "../feed.ts";

export const HIRERS: Hirer[] = [
  {
    id: "maya",
    name: "Maya Chen",
    kind: "human",
    via: "sokosumi",
    description: "Hired Dispatch on Sokosumi so she never has to sit on hold",
  },
  {
    id: "freight_reconciler",
    name: "Freight Reconciler",
    kind: "agent",
    via: "masumi",
    description: "An AI agent reconciling deliveries; it cannot make phone calls itself",
  },
];

export const PARTIES: Party[] = [
  { id: "northwind", name: "Northwind Health claims line", phone_masked: "+1 (555) •••-0142" },
  { id: "bayline", name: "Bayline Logistics depot", phone_masked: "+1 (555) •••-0187" },
];

export interface StoryJob {
  id: string;
  title: string;
  hirer_id: string;
  party_id: string;
  hirer_task: { title: string; resolution: string } | null;
  input: JobInput;
  /** Index of the turn after which the caller waited on hold; the hold lasts until the next turn. */
  hold: { afterTurn: number } | null;
  result: Omit<CallOutcome, "transcript"> & { turns: CallOutcome["transcript"]["turns"] };
}

export const STORY_JOBS: StoryJob[] = [
  {
    id: "job_1",
    title: "Why was my claim denied?",
    hirer_id: "maya",
    party_id: "northwind",
    hirer_task: null,
    input: {
      to: "+15550100142",
      objective: "Find out why claim 88-20417 was denied and open a reconsideration if possible.",
      authorization:
        "May verify identity with member ID NW-5521983 and date of birth. May request a reconsideration. May NOT agree to any payment, plan change or settlement.",
      context: "Member: Maya Chen. Claim 88-20417, physiotherapy, 12 Sep 2026.",
      max_duration_seconds: 2700,
    },
    hold: { afterTurn: 3 },
    result: {
      status: "completed",
      durationSeconds: 1608,
      recordingUrl: null,
      providerCallId: "mock-call-northwind",
      turns: [
        { speaker: "other", text: "Thank you for calling Northwind Health. For claims, press 2.", atSeconds: 0 },
        { speaker: "agent", text: "[pressed 2]", atSeconds: 6 },
        { speaker: "other", text: "Please enter or say your member ID.", atSeconds: 9 },
        { speaker: "agent", text: "N W 5 5 2 1 9 8 3.", atSeconds: 14 },
        { speaker: "other", text: "Claims, this is Daniel. How can I help?", atSeconds: 1352 },
        { speaker: "agent", text: "Hi Daniel. I'm calling for Maya Chen about claim 88-20417. It was denied and she'd like to know why.", atSeconds: 1356 },
        { speaker: "other", text: "Quick question first: am I speaking with a real person?", atSeconds: 1365 },
        { speaker: "agent", text: "No, I'm an AI agent calling on Maya's behalf. I can verify her member ID and date of birth.", atSeconds: 1369 },
        { speaker: "other", text: "Okay, verified. The denial code is CO-197: the provider didn't get prior authorization.", atSeconds: 1410 },
        { speaker: "agent", text: "Can you open a reconsideration so the provider can submit the authorization now?", atSeconds: 1418 },
        { speaker: "other", text: "Done. Reference REF-48213-K. The provider has 30 days to send form PA-2.", atSeconds: 1462 },
        { speaker: "other", text: "I can also move her to the premium plan, which covers this automatically.", atSeconds: 1480 },
        { speaker: "agent", text: "I'm not authorized to change her plan. I'll pass that along to her. Thank you, Daniel.", atSeconds: 1486 },
      ],
      summary: "Denied for missing prior authorization (CO-197). Reconsideration opened; the provider must send form PA-2 within 30 days.",
      artifacts: {
        "Denial code": "CO-197 (no prior authorization)",
        "Reference": "REF-48213-K",
        "Representative": "Daniel, Northwind claims",
        "Deadline": "30 days for the provider to send PA-2",
      },
      humanFollowUp: "Ask the physiotherapy clinic to submit prior-authorization form PA-2, quoting REF-48213-K.",
      caveats: [
        "The transcript proves what the representative said, not that Northwind will honour it.",
        "A plan change was offered and declined: outside the authorization.",
      ],
    },
  },
  {
    id: "job_2",
    title: "Where is shipment SH-7731?",
    hirer_id: "freight_reconciler",
    party_id: "bayline",
    hirer_task: {
      title: "Reconcile October deliveries for Juniper Home",
      resolution: "Exception SH-7731 resolved: pallet held for an address mismatch, redelivery booked. Reconciliation closed.",
    },
    input: {
      to: "+15550100187",
      objective: "Find out why shipment SH-7731 shows delivered but was never received, and get a redelivery date.",
      authorization: "May confirm the delivery address on file. May book a redelivery at no cost. May NOT approve any fee.",
      context: "Consignee: Juniper Home, 41 Alder Street. Shipment SH-7731, 3 pallets.",
      max_duration_seconds: 900,
    },
    hold: { afterTurn: 1 },
    result: {
      status: "completed",
      durationSeconds: 402,
      recordingUrl: null,
      providerCallId: "mock-call-bayline",
      turns: [
        { speaker: "other", text: "Bayline depot. All agents are busy; please hold.", atSeconds: 0 },
        { speaker: "agent", text: "[holding]", atSeconds: 3 },
        { speaker: "other", text: "Bayline, Priya speaking.", atSeconds: 247 },
        { speaker: "agent", text: "Hi Priya, I'm an AI agent calling for Juniper Home about shipment SH-7731. It shows delivered, but nothing arrived.", atSeconds: 250 },
        { speaker: "other", text: "I see it. One pallet was held here: the label says 14 Alder Street, not 41.", atSeconds: 291 },
        { speaker: "agent", text: "The correct address is 41 Alder Street. Can you book a redelivery?", atSeconds: 297 },
        { speaker: "other", text: "Booked for Thursday morning, no charge. Ticket BL-30982.", atSeconds: 331 },
      ],
      summary: "One pallet was held at the depot because of a mislabelled address. Redelivery booked for Thursday at no charge.",
      artifacts: {
        "Cause": "Label read 14 Alder Street; correct is 41",
        "Ticket": "BL-30982",
        "Redelivery": "Thursday morning, no charge",
        "Representative": "Priya, Bayline depot",
      },
      humanFollowUp: null,
      caveats: ["The transcript records the booking; it does not prove the pallet will arrive Thursday."],
    },
  },
];
