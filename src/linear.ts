import { ResolvedFeature } from "./types";
import { LABEL_IDS } from "./config";

const LINEAR_API_URL = "https://api.linear.app/graphql";

export async function verifyLinearSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(computed, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function linearGraphQL<T>(apiKey: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json<{ data: T; errors?: unknown[] }>();
  if (json.errors) {
    throw new Error(`Linear GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const FEATURE_LABEL_ID = LABEL_IDS.Feature;

/**
 * Resolves the parent Feature for an Improvement/Bug/Tech-Refactoring ticket.
 * Priority: native sub-issue parent, then falls back to a "related issue"
 * link if no parent is set (or the parent isn't labeled Feature).
 */
export async function resolveParentFeature(
  apiKey: string,
  issueId: string,
  parentId: string | null | undefined
): Promise<ResolvedFeature | null> {
  if (parentId) {
    const parent = await getIssueSummary(apiKey, parentId);
    if (parent && parent.labelIds.includes(FEATURE_LABEL_ID)) {
      return { id: parent.id, title: parent.title, url: parent.url };
    }
  }

  const related = await getRelatedIssues(apiKey, issueId);
  for (const candidate of related) {
    if (candidate.labelIds.includes(FEATURE_LABEL_ID)) {
      return { id: candidate.id, title: candidate.title, url: candidate.url };
    }
  }

  return null;
}

interface IssueSummary {
  id: string;
  title: string;
  url: string;
  labelIds: string[];
}

async function getIssueSummary(apiKey: string, issueId: string): Promise<IssueSummary | null> {
  const query = `
    query($id: String!) {
      issue(id: $id) {
        id
        title
        url
        labels { nodes { id } }
      }
    }
  `;
  const data = await linearGraphQL<{ issue: any }>(apiKey, query, { id: issueId });
  if (!data.issue) return null;
  return {
    id: data.issue.id,
    title: data.issue.title,
    url: data.issue.url,
    labelIds: data.issue.labels.nodes.map((l: { id: string }) => l.id),
  };
}

async function getRelatedIssues(apiKey: string, issueId: string): Promise<IssueSummary[]> {
  const query = `
    query($id: String!) {
      issue(id: $id) {
        relations {
          nodes {
            type
            relatedIssue { id title url labels { nodes { id } } }
          }
        }
        inverseRelations {
          nodes {
            type
            issue { id title url labels { nodes { id } } }
          }
        }
      }
    }
  `;
  const data = await linearGraphQL<{ issue: any }>(apiKey, query, { id: issueId });
  if (!data.issue) return [];

  const out: IssueSummary[] = [];
  for (const r of data.issue.relations.nodes) {
    if (r.type === "related" && r.relatedIssue) {
      out.push({
        id: r.relatedIssue.id,
        title: r.relatedIssue.title,
        url: r.relatedIssue.url,
        labelIds: r.relatedIssue.labels.nodes.map((l: { id: string }) => l.id),
      });
    }
  }
  for (const r of data.issue.inverseRelations.nodes) {
    if (r.type === "related" && r.issue) {
      out.push({
        id: r.issue.id,
        title: r.issue.title,
        url: r.issue.url,
        labelIds: r.issue.labels.nodes.map((l: { id: string }) => l.id),
      });
    }
  }
  return out;
}
