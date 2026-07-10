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
    "information that isn't present in the source.\n\n" +
    `Raw ticket description:\n${rawDescription || "(no description was provided)"}`;

  return callClaude(apiKey, prompt, 1024);
}

/**
 * Used on every Improvement/Bug/Tech-Refactoring completion: regenerates the
 * ENTIRE Description section as one coherent narrative, folding in the new
 * ticket rather than just tacking a paragraph onto the end.
 */
export async function rewriteDescriptionWithUpdate(
  apiKey: string,
  currentDescription: string,
  ticket: SubTicketInfo
): Promise<string> {
  const prompt =
    "You maintain the knowledge-base \"Description\" section for a software " +
    "feature. Below is the CURRENT description, followed by a NEW update that " +
    "just shipped. Rewrite the full description to incorporate the new update " +
    "coherently as a single narrative — integrate the new information where it " +
    "fits naturally, rather than appending a disconnected paragraph. Preserve " +
    "existing factual details unless the new update explicitly supersedes them. " +
    "Do not invent facts that aren't present in either source.\n\n" +
    `CURRENT DESCRIPTION:\n${currentDescription || "(empty)"}\n\n` +
    `NEW ${ticket.labelName.toUpperCase()} UPDATE — "${ticket.title}":\n` +
    `${ticket.description || "(no additional detail was provided)"}`;

  return callClaude(apiKey, prompt, 1200);
}

/**
 * Used on every Improvement/Bug/Tech-Refactoring completion: a short,
 * specific summary sentence for the dated Change History entry.
 */
export async function summarizeChangeEntry(apiKey: string, ticket: SubTicketInfo): Promise<string> {
  const prompt =
    "Write a single concise sentence (30 words or fewer) summarizing what this " +
    `${ticket.labelName} ticket changed, suitable for a dated changelog entry. ` +
    "Be specific and factual — no filler, no restating the ticket title verbatim.\n\n" +
    `Ticket: "${ticket.title}"\n` +
    `Details: ${ticket.description || "(no additional detail was provided)"}`;

  return callClaude(apiKey, prompt, 120);
}
