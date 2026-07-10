// Sends the sample webhook payloads to a locally running worker
// (`npm run dev`, listening on http://127.0.0.1:8787), signed the same way
// Linear signs real webhooks, so this exercises the exact HTTP path Linear
// will hit in production — including signature verification.
//
// Requires .dev.vars to contain LINEAR_WEBHOOK_SECRET (any string works
// locally, as long as it's the same one wrangler dev loads).
//
// Usage: npm run test:dry-run

import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PORT = process.env.WORKER_PORT ?? "8787";
const SECRET = process.env.LINEAR_WEBHOOK_SECRET;

if (!SECRET) {
  console.error("Set LINEAR_WEBHOOK_SECRET in the environment (same value as .dev.vars) before running.");
  process.exit(1);
}

const dir = join(__dirname, "sample-payloads");

async function main() {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const raw = readFileSync(join(dir, file), "utf8");
    const signature = createHmac("sha256", SECRET!).update(raw).digest("hex");

    const res = await fetch(`http://127.0.0.1:${PORT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "linear-signature": signature },
      body: raw,
    });

    console.log(`${file}: ${res.status} ${await res.text()}`);
  }
}

main();
