// Static config pulled from Sasha's workspaces on 2026-07-10.
// If labels/states/team change in Linear, or the Notion database is moved,
// update the corresponding value here (or move these to env vars if they'll
// change often).

export const LINEAR_TEAM_ID = "c0f2d715-0d64-4504-8183-79ae6e297432"; // "Sasha's Playground"

export const LABEL_IDS = {
  Feature: "535a846f-4bab-4a83-9277-3d073a8ded0d",
  Improvement: "6bb9a3a6-6c85-47cc-9635-b82394f67bb5",
  Bug: "64de8e14-c2bd-45d6-b0ab-8d3de9873b4b",
  TechRefactoring: "cafb2640-7c72-43a4-a609-caacb47fd98c",
  Research: "2b121118-4ce1-49ba-bfe1-ca847bf258cc",
} as const;

// Labels whose tickets, once marked Done, get logged against their parent Feature.
export const SUB_TICKET_LABELS = new Set<string>([
  LABEL_IDS.Improvement,
  LABEL_IDS.Bug,
  LABEL_IDS.TechRefactoring,
]);

export const STATE_DONE_ID = "edea16c6-4774-4c8d-8d24-34a213e13d66"; // "Done" workflow state

// Notion database "Linear - Notion knowledge base" > "New database"
// (opened as its own page to read the ID out of the URL).
export const NOTION_DATABASE_ID = "3995ca6f-c963-8049-8c04-f2d9cd9569ed";

// Notion property names — must match the database exactly.
export const NOTION_PROPS = {
  title: "Feature",
  project: "Project",
  linearUrl: "Linear URLs",
} as const;

export const SECTION_HEADINGS = {
  description: "Description",
  history: "Change History",
} as const;

// Model used for the AI rewrite/summarization step. Haiku-class model:
// fast and cheap, plenty for rewriting a knowledge-base paragraph. Swap to
// "claude-sonnet-5" in this one place if you want higher-effort prose.
export const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
