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
 * Used on every Improvement/Bug/Tech-Refactoring completion. This does NOT
 * rewrite the existing Description — it writes a short, self-contained
 * update note describing what this one ticket changed, which gets appended
 * to the end of the Description section. The current description is passed
 * in purely as context (so the note doesn't clumsily restate something
 * already said), never as something to reproduce or edit.
 */
export async function describeTicketUpdate(
  apiKey: string,
  currentDescription: string,
  ticket: SubTicketInfo
): Promise<string> {
  const prompt =
    "You are adding a short update note to an existing feature's knowledge-base " +
    "entry, for a ticket that just shipped. Write 1–3 sentences of plain prose " +
    "describing specifically what this ticket changed or added for the " +
    "feature, based on the ticket details below. Be factual and specific — " +
    "don't invent information, don't restate the ticket title verbatim, and " +
    "don't add a heading or bullet marker of your own (just the sentences).\n\n" +
    "You are NOT rewriting or summarizing the whole feature — the current " +
    "description below is given only so your note doesn't clumsily repeat " +
    "something already stated. Do not reproduce, rephrase, or edit it.\n\n" +
    `CURRENT DESCRIPTION (context only, do not reproduce):\n${currentDescription || "(empty)"}\n\n` +
    `NEW ${ticket.labelName.toUpperCase()} TICKET — "${ticket.title}":\n` +
    `${ticket.description || "(no additional detail was provided)"}`;

  return callClaude(apiKey, prompt, 300);
}
