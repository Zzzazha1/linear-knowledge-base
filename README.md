# Linear → Notion knowledge base sync

A Cloudflare Worker that listens to Linear webhooks and keeps a Notion
database in sync, per the rules below.

## What it does

| Linear label | Trigger | Notion action |
|---|---|---|
| `Feature` | ticket moves to **Done** | Creates a new page in the Features database: title, project, Linear URL. The raw ticket description is sent to Claude to be rewritten into a clean knowledge-base entry, then inserted under a "Description" heading. Skipped if a page for that Linear URL already exists (idempotent). |
| `Improvement` / `Bug` / `Tech / Refactoring` | ticket moves to **Done** | Resolves the parent Feature (native sub-issue `parentId` first, falls back to a "related issue" link). Claude writes a short (1–3 sentence) update note describing just what this ticket changed, which is **appended** to the end of the Description section — the existing text is never touched or reworded. A plain (non-AI) dated entry is also logged under "Change History" (newest on top): `YYYY-MM-DD — Label: ticket title (link)`. |
| `Research` | any event | Ignored entirely — not synced. |

If a sub-ticket (Improvement/Bug/Tech) reaches Done before its parent
Feature has ever reached Done itself, there's no Notion page to attach to
yet — the worker logs a warning and skips it. Nothing retries automatically;
re-triggering the sub-ticket's Done transition (e.g. toggling status) after
the Feature exists will pick it up.

**AI behavior and fallback.** The Description section is only ever appended
to, never rewritten or deleted — each sub-ticket completion adds one short,
Claude-written note about that specific change to the end of the section,
so existing wording is never touched. (An earlier version of this worker
did a full rewrite of the whole section on every update; that turned out to
produce inconsistent results and involved deleting and re-inserting many
Notion blocks per update, which was slower and more failure-prone. This
append-only approach is deliberately simpler and more stable.) If the
Anthropic API call fails for any reason (rate limit, outage, bad key), the
worker logs the error and appends the raw ticket title/description instead
of the AI note — so a Claude hiccup never drops the update. Change History
entries are always plain text, no AI involved, so they're unaffected by any
of this. Each Feature creation and sub-ticket completion makes one small
Claude API call (`claude-haiku-4-5-20251001` by default — cheap and fast;
change the model in `src/config.ts` if you want higher-effort prose from
`claude-sonnet-5` instead).

## Pre-filled configuration

`src/config.ts` already has your workspace's real IDs, pulled on 2026-07-10:

- Team: **Sasha's Playground**
- Label IDs for Feature / Improvement / Bug / Tech / Refactoring / Research
- "Done" workflow state ID
- Notion database ID (the "New database" inside your *Linear - Notion
  knowledge base* page), and its three properties: `Feature` (title),
  `Project` (text), `Linear URLs` (url)

If you rename a label, add a team, or move the database, update the
matching constant in `src/config.ts`.

## One-time setup

### 1. Notion integration

Your OAuth connector wasn't cooperating, so this uses a direct internal
integration instead:

1. Go to <https://www.notion.so/my-integrations> → **New integration** →
   internal, any workspace you like → copy the **Internal Integration
   Secret**.
2. Open the *Linear - Notion knowledge base* page in Notion → `...` menu →
   **Connections** → add the integration you just created. (Sharing the
   parent page shares the inline database too.)

### 2. Linear API key

<https://linear.app/settings/api> → **Personal API keys** → create one with
read access to your workspace. Copy it.

### 2b. Anthropic API key

<https://console.anthropic.com> → **API Keys** → **Create Key** → copy it
(starts with `sk-ant-`). This is what powers the description rewriting and
change summaries — see "AI rewrite behavior" above for what it's used for
and what happens if a call fails.

### 3. Linear webhook

<https://linear.app/settings/api> → **Webhooks** → **New webhook**:

- URL: your deployed Worker URL (see step 5) — Linear will want this before
  you deploy, so either deploy once first and update the URL after, or
  create the webhook after step 5.
- Data change events: **Issues** only (uncheck the rest).
- Copy the **signing secret** shown — that's `LINEAR_WEBHOOK_SECRET`.

### 4. Install dependencies

```bash
npm install
```

### 5. Configure and deploy

```bash
npx wrangler login
npx wrangler secret put LINEAR_API_KEY
npx wrangler secret put NOTION_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npm run deploy
```

(`LINEAR_WEBHOOK_SECRET` isn't set yet — deploying doesn't require it. Set
it after creating the webhook below, once Linear gives you the real signing
secret.)

`wrangler deploy` prints the Worker's URL — that's what goes in the Linear
webhook config from step 3 (create or update the webhook with it now).

## Local testing before you deploy

```bash
cp .dev.vars.example .dev.vars   # fill in real or scratch-DB values
npm run dev                       # starts the worker on :8787
LINEAR_WEBHOOK_SECRET=<same value as .dev.vars> npm run test:dry-run
```

`test:dry-run` sends the three sample payloads in `test/sample-payloads/`
through the real signature-verification path:

- `feature-done.json` → should create a Notion page.
- `bug-done-subissue.json` → parented to the same fake Feature id used
  above; only resolves to a real Notion page if you first change its
  `parentId`/URL to match a Feature you actually created in your test DB.
- `research-skipped.json` → should be a no-op (200, no Notion calls).

Point `NOTION_DATABASE_ID` at a scratch database while testing so you're not
writing sample data into your real knowledge base — swap it back to the real
one (already the default in `src/config.ts`) before deploying for real.

## Known limitations / things to revisit

- **Markdown fidelity**: `src/markdown.ts` covers headings, paragraphs,
  bullet/numbered/checkbox lists, blockquotes, code blocks, and basic inline
  formatting (bold/italic/code/links). Tables and nested lists aren't
  specially handled and will flatten to plain text.
- **"Related" resolution costs an extra API call**: sub-issues resolve in
  one Linear query; falling back to "related" issues costs one more. Not an
  issue at this volume, just worth knowing if the workspace gets large.
- **No cross-run state store**: idempotency for Feature creation is done by
  querying Notion for an existing page with that Linear URL before creating
  — reliable, but means every Feature-Done event does one extra Notion read.
- **Fire-and-forget processing, no automatic retries**: the Worker
  acknowledges Linear's webhook immediately (`200 ok`) and does the actual
  Linear/Notion/Claude work afterward via `ctx.waitUntil`, rather than
  making Linear wait on the full chain of API calls. This avoids Linear's
  webhook delivery timing out and canceling the request mid-flight (which
  could leave a page half-updated) — but it also means Linear no longer
  sees a failing status code if something goes wrong during that background
  work, so it won't automatically retry. If a sync seems to be missing,
  check the Cloudflare dashboard's **Observability → Logs** for that
  Worker; failures are logged there with the specific error.
