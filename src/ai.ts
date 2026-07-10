import { ANTHROPIC_MODEL } from "./config";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT =
  "You are a precise technical writer maintaining a software team's internal " +
  "knowledge base. You write clear, neutral, professional prose. You never " +
  "invent facts that aren't present in the source material you're given — " +
  "if something is unclear or missing, leave it out rather than guessing. " +
  "Output only the requested content in Markdown, with no preamble, no " +
  "meta-commentary, and no wrapping code fence around the whole response.";

async function callClaude(apiKey: string, userPrompt: string, maxTokens: number): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json<{ content: { type: string; text?: string }[] }>();
  const text = json.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Anthropic response had no text content");
  return text.trim();
}

export interface SubTicketInfo {
  title: string;
  labelName: string;
  description: string;
}

/**
 * Used when a Feature ticket first reaches Done: turns the raw Linear
 * description into a clean knowledge-base entry, without inventing content.
 */
export async function generateFeatureDescription(apiKey: string, rawDescription: string): Promise<string> {
  const prompt =
    "Rewrite the following raw ticket description into a clean, well-organized " +
    "knowledge-base entry for this feature. Preserve every factual detail " +
    "(behavior, scope, technical notes). Improve structure and clarity, and use " +
    "headings or bullets where they genuinely help — but don't invent " +
    "information that isn't present in the source. Output only the body content " +
    "itself — don't give it a title or heading that just repeats \"Description\" " +
    "or \"Change History\".\n\n" +
    `Raw ticket description:\n${rawDescription || "(no description was provided)"}`;

  return callClaude(apiKey, prompt, 1024);
}

/**
 * Used on every Improvement/Bug/Tech-Refactoring completion. Returns the
 * FULL updated Description text with the new ticket's content woven in
 * naturally, so a reader only ever needs the current text — not a trail of
 * separate update notes — to understand the feature's current state.
 *
 * This is an edit, not a free rewrite: existing wording must be preserved
 * verbatim wherever the new ticket doesn't touch it. The whole section gets
 * replaced in Notion with this output (see replaceDescriptionSection), which
 * is safe to do now that processing happens in the background
 * (ctx.waitUntil) rather than being racing a webhook response timeout.
 */
export async function updateFeatureDescription(
  apiKey: string,
  currentDescription: string,
  ticket: SubTicketInfo
): Promise<string> {
  const prompt =
    "You maintain the knowledge-base \"Description\" for a software feature. " +
    "Below is the CURRENT description, followed by a ticket that just shipped " +
    "for it. Produce the FULL updated description — this text will completely " +
    "replace the current one, so it must stand on its own as a complete, " +
    "coherent description of the feature's current state. A reader should " +
    "never need to look anywhere else (like a changelog) to understand what " +
    "the feature does today.\n\n" +
    "Rules:\n" +
    "- Copy sentences and bullets the new ticket doesn't affect across " +
    "verbatim. Do not rephrase, reorder, condense, or drop anything that's " +
    "still accurate.\n" +
    "- Weave the new ticket's content into the existing prose at the most " +
    "relevant point — as a natural part of the description, not as a " +
    "separate \"update\" paragraph, note, or bullet tacked onto the end. If it " +
    "corrects or refines something already stated, edit that part in place. " +
    "If it's a genuinely new detail, add it where a reader would expect to " +
    "find it alongside related information.\n" +
    "- Never let the newest ticket dominate the description or shift its " +
    "focus — it should read exactly like a description someone wrote fresh " +
    "today, with no sign of which detail was added most recently.\n" +
    "- Do not shorten the description. If anything it should be the same " +
    "length or slightly longer than the current version.\n" +
    "- Do not invent facts that aren't present in either source.\n" +
    "- Output only the description body — no title, and no heading that just " +
    "repeats \"Description\" or \"Change History\".\n\n" +
    `CURRENT DESCRIPTION:\n${currentDescription || "(empty)"}\n\n` +
    `NEW ${ticket.labelName.toUpperCase()} TICKET — "${ticket.title}":\n` +
    `${ticket.description || "(no additional detail was provided)"}`;

  return callClaude(apiKey, prompt, 1500);
}
