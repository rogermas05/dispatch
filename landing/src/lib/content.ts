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
