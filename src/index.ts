import { Env, LinearWebhookPayload } from "./types";
import { LABEL_IDS, STATE_DONE_ID, SUB_TICKET_LABELS } from "./config";
import { verifyLinearSignature, resolveParentFeature } from "./linear";
import {
  createFeaturePage,
  findFeaturePageByUrl,
  appendToDescription,
  appendToHistory,
  getDescriptionMarkdown,
  replaceDescriptionSection,
} from "./notion";
import { markdownToBlocks, heading2, bulleted, paragraph } from "./markdown";
import { generateFeatureDescription, updateFeatureDescription } from "./ai";

const LABEL_NAME_BY_ID: Record<string, string> = {
  [LABEL_IDS.Feature]: "Feature",
  [LABEL_IDS.Improvement]: "Improvement",
  [LABEL_IDS.Bug]: "Bug",
  [LABEL_IDS.TechRefactoring]: "Tech / Refactoring",
  [LABEL_IDS.Research]: "Research",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Linear -> Notion sync worker. POST webhooks here.", { status: 200 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get("linear-signature");
    const valid = await verifyLinearSignature(rawBody, signature, env.LINEAR_WEBHOOK_SECRET);
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: LinearWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // Acknowledge immediately, then do the actual work (Linear lookups,
    // Notion reads/writes, the Claude call) in the background via
    // waitUntil. The real processing is a chain of several network calls
    // and can comfortably exceed a webhook provider's response timeout —
    // Linear was canceling the connection mid-flight while waiting, which
    // could interrupt a request partway through. Acking fast avoids that;
    // any failure during background processing is logged (check the
    // Cloudflare dashboard's Observability > Logs), but note Linear no
    // longer sees a failing status code to retry on, since it already got
    // its 200.
    ctx.waitUntil(
      handleWebhook(payload, env).catch((err) => {
        console.error("Background webhook processing failed", err);
      })
    );

    return new Response("ok", { status: 200 });
  },
};

async function handleWebhook(payload: LinearWebhookPayload, env: Env): Promise<void> {
  if (payload.type !== "Issue" || payload.action !== "update") return;

  const issue = payload.data;
  const labelIds = issue.labelIds ?? issue.labels?.map((l) => l.id) ?? [];

  if (labelIds.includes(LABEL_IDS.Research)) return; // explicitly skipped

  // Only act on a transition INTO Done (ignore edits made while already Done,
  // and ignore unrelated field updates).
  const updatedFrom = payload.updatedFrom ?? {};
  if (!("stateId" in updatedFrom)) return;
  const currentStateId = issue.state?.id ?? issue.stateId;
  if (currentStateId !== STATE_DONE_ID) return;
  if (updatedFrom.stateId === STATE_DONE_ID) return;

  if (labelIds.includes(LABEL_IDS.Feature)) {
    await handleFeatureDone(issue, env);
    return;
  }

  const subTicketLabelId = labelIds.find((id) => SUB_TICKET_LABELS.has(id));
  if (subTicketLabelId) {
    await handleSubTicketDone(issue, subTicketLabelId, env);
  }
}

async function handleFeatureDone(issue: LinearWebhookPayload["data"], env: Env): Promise<void> {
  const existing = await findFeaturePageByUrl(env.NOTION_TOKEN, issue.url);
  if (existing) return; // already synced (duplicate delivery, or was Done before)

  const rawDescription = issue.description ?? "";
  let descriptionMarkdown = rawDescription;
  try {
    descriptionMarkdown = await generateFeatureDescription(env.ANTHROPIC_API_KEY, rawDescription);
  } catch (err) {
    // AI polish is a nice-to-have on creation — never let it block getting
    // the Feature into Notion at all.
    console.error(`AI polish failed for ${issue.url}, using raw description`, err);
  }

  await createFeaturePage(env.NOTION_TOKEN, {
    title: issue.title,
    project: issue.project?.name ?? "",
    linearUrl: issue.url,
    descriptionBlocks: markdownToBlocks(descriptionMarkdown),
  });
}

async function handleSubTicketDone(
  issue: LinearWebhookPayload["data"],
  subTicketLabelId: string,
  env: Env
): Promise<void> {
  const feature = await resolveParentFeature(env.LINEAR_API_KEY, issue.id, issue.parentId);
  if (!feature) {
    // No linked Feature found (or the Feature ticket hasn't reached Done yet,
    // so no Notion page exists). Nothing to attach this update to.
    console.warn(`No parent Feature resolved for ${issue.url}`);
    return;
  }

  const pageId = await findFeaturePageByUrl(env.NOTION_TOKEN, feature.url);
  if (!pageId) {
    console.warn(`Feature ${feature.url} has no Notion page yet; skipping sync for ${issue.url}`);
    return;
  }

  const labelName = LABEL_NAME_BY_ID[subTicketLabelId] ?? "Update";
  const today = new Date().toISOString().slice(0, 10);
  const ticketInfo = { title: issue.title, labelName, description: issue.description ?? "" };

  // Replace the Description with a fully updated version that weaves the
  // new ticket's content into the existing prose — so reading the current
  // text alone tells you the feature's current state, with no need to also
  // read through separate per-ticket notes. Safe to do as a full
  // read-then-replace now that this runs in the background (ctx.waitUntil)
  // rather than racing a webhook response timeout. Falls back to a plain
  // append of the raw ticket text if the AI call fails, so a Claude hiccup
  // never drops the update entirely.
  try {
    const currentDescription = await getDescriptionMarkdown(env.NOTION_TOKEN, pageId);
    const updated = await updateFeatureDescription(env.ANTHROPIC_API_KEY, currentDescription, ticketInfo);
    await replaceDescriptionSection(env.NOTION_TOKEN, pageId, updated);
  } catch (err) {
    console.error(`AI description update failed for ${issue.url}, falling back to raw append`, err);
    await appendToDescription(env.NOTION_TOKEN, pageId, [
      paragraph(`[${labelName}] ${issue.title}`),
      ...markdownToBlocks(issue.description),
    ]);
  }

  // Change History: plain append, no AI — just log that this ticket completed.
  await appendToHistory(env.NOTION_TOKEN, pageId, [
    bulleted(`${today} — ${labelName}: ${issue.title} (${issue.url})`),
  ]);
}
