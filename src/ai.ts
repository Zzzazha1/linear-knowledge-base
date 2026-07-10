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
 * Used on every Improvement/Bug/Tech-Refactoring completion: makes a
 * minimally-invasive edit to the Description — preserve almost everything
 * verbatim, only touch the part(s) the new ticket actually affects.
 */
export async function rewriteDescriptionWithUpdate(
  apiKey: string,
  currentDescription: string,
  ticket: SubTicketInfo
): Promise<string> {
  const prompt =
    "You maintain the knowledge-base \"Description\" section for a software " +
    "feature. Below is the CURRENT description, followed by a NEW update that " +
    "just shipped for it.\n\n" +
    "Your edit must be minimally invasive:\n" +
    "- Treat the CURRENT DESCRIPTION as correct and complete except where the " +
    "NEW UPDATE changes it. Copy unaffected sentences and bullets across " +
    "verbatim — do not rephrase, reorder, condense, or summarize any part of " +
    "the current description that the new update doesn't touch.\n" +
    "- Identify only the specific detail(s) the new update actually changes " +
    "(a bug fix, a behavior tweak, a new capability, a refactor). Edit just " +
    "that sentence/bullet in place if the update corrects or refines it, or " +
    "add one new short sentence/bullet in the most relevant existing spot if " +
    "it's a genuinely new detail. This is an edit, not a rewrite.\n" +
    "- Never shift the description's overall focus toward the newest change — " +
    "it should still read primarily as a description of the feature as a " +
    "whole, with the update woven in as one detail among the others.\n" +
    "- Do not shorten the description. If anything, it should be the same " +
    "length or very slightly longer than the current version.\n" +
    "- Do not invent facts that aren't present in either source.\n" +
    "- Output only the body content itself — don't give it a title or heading " +
    "that just repeats \"Description\" or \"Change History\".\n\n" +
    `CURRENT DESCRIPTION:\n${currentDescription || "(empty)"}\n\n` +
    `NEW ${ticket.labelName.toUpperCase()} UPDATE — "${ticket.title}":\n` +
    `${ticket.description || "(no additional detail was provided)"}`;

  return callClaude(apiKey, prompt, 1500);
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
