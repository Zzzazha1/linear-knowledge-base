import { Env, LinearWebhookPayload } from "./types";
import { LABEL_IDS, STATE_DONE_ID, SUB_TICKET_LABELS } from "./config";
import { verifyLinearSignature, resolveParentFeature } from "./linear";
import { createFeaturePage, findFeaturePageByUrl, appendToDescription, appendToHistory } from "./notion";
import { markdownToBlocks, heading2, bulleted, paragraph } from "./markdown";

const LABEL_NAME_BY_ID: Record<string, string> = {
  [LABEL_IDS.Feature]: "Feature",
  [LABEL_IDS.Improvement]: "Improvement",
  [LABEL_IDS.Bug]: "Bug",
  [LABEL_IDS.TechRefactoring]: "Tech / Refactoring",
  [LABEL_IDS.Research]: "Research",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    try {
      await handleWebhook(payload, env);
      return new Response("ok", { status: 200 });
    } catch (err) {
      console.error(err);
      // 500 so Linear retries — covers transient Notion/Linear API hiccups.
      return new Response(`error: ${(err as Error).message}`, { status: 500 });
    }
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

  const descriptionBlocks = markdownToBlocks(issue.description);
  await createFeaturePage(env.NOTION_TOKEN, {
    title: issue.title,
    project: issue.project?.name ?? "",
    linearUrl: issue.url,
    descriptionBlocks,
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

  // Append the ticket's own detail to the running Description narrative.
  await appendToDescription(env.NOTION_TOKEN, pageId, [
    paragraph(`[${labelName}] ${issue.title}`),
    ...markdownToBlocks(issue.description),
  ]);

  // Log a dated entry in Change History (newest on top).
  await appendToHistory(env.NOTION_TOKEN, pageId, [
    bulleted(`${today} — ${labelName}: ${issue.title} (${issue.url})`),
  ]);
}
