// Emits the feed JSON Schema so non-TypeScript services (the Python backend) can
// validate against, or generate models from, the same contract.
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { Feed } from "../src/feed.ts";

const outPath = new URL("../feed.schema.json", import.meta.url);
writeFileSync(outPath, `${JSON.stringify(z.toJSONSchema(Feed, { io: "input" }), null, 2)}\n`);
process.stdout.write(`wrote ${outPath.pathname}\n`);
