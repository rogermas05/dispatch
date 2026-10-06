// Writes the deterministic mock story feed the dashboard loads by default.
import { writeFileSync } from "node:fs";
import { Feed } from "@token-origins/schema";
import { buildMockFeed } from "@token-origins/schema/mock";

const feed = Feed.parse(buildMockFeed());
const outPath = new URL("../public/mock-feed.json", import.meta.url);
writeFileSync(outPath, `${JSON.stringify(feed, null, 2)}\n`);
process.stdout.write(`wrote ${feed.events.length} events to ${outPath.pathname}\n`);
