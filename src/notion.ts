import { NOTION_DATABASE_ID, NOTION_PROPS, SECTION_HEADINGS } from "./config";
import { NotionBlock, heading2 } from "./markdown";

const NOTION_VERSION = "2022-06-28";
const NOTION_API = "https://api.notion.com/v1";

async function notionFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Notion API error ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json<any>();
}

/** Finds an existing Feature page by its "Linear URLs" property. Returns the page id, or null. */
export async function findFeaturePageByUrl(token: string, linearUrl: string): Promise<string | null> {
  const result = await notionFetch(token, `/databases/${NOTION_DATABASE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: NOTION_PROPS.linearUrl, url: { equals: linearUrl } },
      page_size: 1,
    }),
  });
  return result.results?.[0]?.id ?? null;
}

export async function createFeaturePage(
  token: string,
  opts: { title: string; project: string; linearUrl: string; descriptionBlocks: NotionBlock[] }
): Promise<string> {
  const children: NotionBlock[] = [
    heading2(SECTION_HEADINGS.description),
    ...(opts.descriptionBlocks.length
      ? opts.descriptionBlocks
      : [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }]),
    heading2(SECTION_HEADINGS.history),
  ];

  const page = await notionFetch(token, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        [NOTION_PROPS.title]: { title: [{ text: { content: opts.title } }] },
        [NOTION_PROPS.project]: { rich_text: [{ text: { content: opts.project } }] },
        [NOTION_PROPS.linearUrl]: { url: opts.linearUrl },
      },
      // Notion allows up to 100 children on page creation; Feature descriptions
      // should comfortably fit. If one ever doesn't, split into an initial
      // create + follow-up append.
      children: children.slice(0, 100),
    }),
  });
  return page.id;
}

interface BlockListItem {
  id: string;
  type: string;
  [key: string]: any;
}

async function listChildren(token: string, blockId: string): Promise<BlockListItem[]> {
  const out: BlockListItem[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const result = await notionFetch(token, `/blocks/${blockId}/children${qs}`);
    out.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  return out;
}

function headingText(block: BlockListItem): string | null {
  const type = block.type;
  if (type !== "heading_1" && type !== "heading_2" && type !== "heading_3") return null;
  const richText = block[type]?.rich_text ?? [];
  return richText.map((t: any) => t.plain_text ?? t.text?.content ?? "").join("");
}

async function appendChildren(token: string, blockId: string, children: NotionBlock[], after?: string) {
  await notionFetch(token, `/blocks/${blockId}/children`, {
    method: "PATCH",
    body: JSON.stringify(after ? { children, after } : { children }),
  });
}

/**
 * Appends new content to the end of the "Description" section (i.e. right
 * before the "Change History" heading), so the description reads as a
 * running narrative in chronological order.
 */
export async function appendToDescription(token: string, pageId: string, blocks: NotionBlock[]) {
  const children = await listChildren(token, pageId);
  const descIdx = children.findIndex((b) => headingText(b) === SECTION_HEADINGS.description);
  const historyIdx = children.findIndex((b) => headingText(b) === SECTION_HEADINGS.history);

  let anchor: string | undefined;
  if (historyIdx > 0) {
    anchor = children[historyIdx - 1].id; // last block before "Change History"
  } else if (descIdx >= 0) {
    anchor = children[descIdx].id; // right after "Description" heading
  }
  await appendChildren(token, pageId, blocks, anchor);
}

/**
 * Appends a new entry directly under "Change History", newest entry on top.
 */
export async function appendToHistory(token: string, pageId: string, blocks: NotionBlock[]) {
  const children = await listChildren(token, pageId);
  const historyIdx = children.findIndex((b) => headingText(b) === SECTION_HEADINGS.history);
  const anchor = historyIdx >= 0 ? children[historyIdx].id : undefined;
  await appendChildren(token, pageId, blocks, anchor);
}
