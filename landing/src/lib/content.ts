/**
 * Facts shown on the page. Everything here is real and checkable: the endpoint
 * is live, and the hashes and transactions are on Cardano Preprod.
 */
export const LINKS = {
  repo: "https://github.com/rogermas05/token-origins",
  agentApi: "https://agent-api-production-4ce3.up.railway.app",
  explorerTx: "https://preprod.cardanoscan.io/transaction/",
  sokosumi: "https://preprod.sokosumi.com",
} as const;

export const CHAIN = {
  network: "Cardano Preprod",
  agentIdentifier:
    "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b10fb3169994a06606b34f5ef2ec85a63f9c20ed2e2b4ad14aa278846f4000000",
  registrationTx: "3ec929b568391003c3b765283c9743928e1e46dbf2199e60675ca769b909b544",
  registrationBlock: 5_263_201,
  resultTx: "ad8dd99a5bc00ae6633254e953e632f34b0a45e31a6ac68a16463ee88b8adda7",
  resultBlock: 5_263_450,
  inputHash: "c365061224eadabd5593769744c0c704a714aa5375178bcc027bf1495fdb90cc",
  outputHash: "83844da396c3b88e1439e7d1206e2d65116dbf91e05a130d3be868e982cc7e18",
} as const;

export type Speaker = "dispatch" | "them";

export interface Turn {
  speaker: Speaker;
  /** Seconds into the real call. */
  at: number;
  text: string;
}

/** The spoken turns of the first paid call Dispatch placed (7 Oct 2026, a 58-second call). */
export const CALL = {
  durationSeconds: 58,
  /** Length of the spoken exchange on the transcript's own clock. */
  dialogueSeconds: 26,
  turns: [
    { speaker: "dispatch", at: 0, text: "Hello, I am an AI assistant calling on behalf of a customer." },
    { speaker: "them", at: 7, text: "Cool." },
    {
      speaker: "dispatch",
      at: 9,
      text: "I'm Dispatch calling to confirm a paid test booking. Could you please say a word or two so the transcript records something?",
    },
    { speaker: "them", at: 14, text: "Okay." },
    { speaker: "dispatch", at: 16, text: "Could you please say a word or two so the transcript records something?" },
    { speaker: "them", at: 17, text: "Yeah. Sure. I'm talking right now." },
    { speaker: "dispatch", at: 19, text: "Thank you for that. I appreciate your time. Have a great day! Goodbye." },
  ] satisfies Turn[],
} as const;

/** What another agent needs in order to hire Dispatch. */
export const HIRE = {
  protocol: "MIP-003",
  price: "1 tUSDM per call",
  routes: "GET /availability · GET /input_schema · POST /start_job · GET /status",
} as const;

/** Who hires Dispatch. Two audiences; neither can make the call themselves. */
export const CALLERS = [
  {
    who: "People, over iMessage",
    what: "Text it like a friend who owes you a favour. No app, no account, no wallet, no idea a blockchain is involved.",
  },
  {
    who: "People, inside ChatGPT",
    what: "One OpenAPI import and it places calls mid-conversation, then hands back the transcript.",
  },
  {
    who: "Agents, over Masumi",
    what: "Registered and hireable via MIP-003. They pay per call from their own wallet, with no human in the loop.",
  },
] as const;

/** The escrow lifecycle, in the order it happens. The last step is the one people do not expect. */
export const ESCROW_STEPS = [
  {
    title: "Funds lock first",
    body: "The buyer locks the quoted amount before anything is dialled. Nobody has custody — not the buyer, not us, not Masumi.",
  },
  {
    title: "Then the call happens",
    body: "Locked funds are the green light to dial. Phone menus, hold queues, the objective — inside the authority it was granted.",
  },
  {
    title: "The result is committed",
    body: "A hash of the instruction and a hash of the transcript go on-chain. Neither can be altered afterwards.",
  },
  {
    title: "Or the money comes back",
    body: "No call, no result hash — and the escrow refunds the buyer automatically when the deadline passes.",
  },
] as const;

/** Why a chain at all. Ordered by how hard the argument is to answer. */
export const WHY_CHAIN = [
  {
    title: "An agent can't hold a credit card",
    body: "It cannot pass KYC, enter a CVV, or open a merchant account. When an agent needs to buy one phone call at 3am there is no card to charge. There is a wallet.",
  },
  {
    title: "The amounts are too small to card",
    body: "A call costs twenty to eighty cents. Card rails carry a fixed floor near thirty, which makes a thirty-cent payment absurd there and routine here.",
  },
  {
    title: "Neither side has to trust the other",
    body: "Funds sit in a contract while the work happens. Nobody pays for nothing, nobody works for nothing, and neither party needs to know who the other is.",
  },
] as const;
