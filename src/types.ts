export interface Env {
  LINEAR_API_KEY: string;
  LINEAR_WEBHOOK_SECRET: string;
  NOTION_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}

// Subset of Linear's webhook "Issue" payload we actually use.
// Linear expands labels/state/project/team on webhook payloads; raw ids are
// also present and used as a fallback if the expanded object is missing.
export interface LinearWebhookIssue {
  id: string;
  identifier?: string;
  title: string;
  description?: string | null;
  url: string;
  parentId?: string | null;
  stateId?: string;
  state?: { id: string; name: string; type: string };
  labelIds?: string[];
  labels?: { id: string; name: string }[];
  project?: { id: string; name: string } | null;
  team?: { id: string; name: string };
}

export interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: string; // "Issue", "Comment", etc.
  data: LinearWebhookIssue;
  updatedFrom?: Record<string, unknown>;
  url?: string;
  createdAt?: string;
  organizationId?: string;
  webhookId?: string;
}

export interface ResolvedFeature {
  id: string;
  title: string;
  url: string;
}
