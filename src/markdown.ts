// Minimal Markdown -> Notion block converter.
// Linear issue descriptions are plain Markdown. This covers the subset that
// shows up in practice: headings, paragraphs, bullet/numbered/checkbox
// lists, blockquotes, fenced code blocks, and inline bold/italic/code/links.
// It is not a full CommonMark implementation — nested lists and tables are
// flattened to their best plain-text approximation.

type RichText = {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: Partial<{
    bold: boolean;
    italic: boolean;
    code: boolean;
    strikethrough: boolean;
  }>;
};

export type NotionBlock = Record<string, any>;

const NOTION_TEXT_LIMIT = 2000;

function chunk(content: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < content.length; i += NOTION_TEXT_LIMIT) {
    out.push(content.slice(i, i + NOTION_TEXT_LIMIT));
  }
  return out.length ? out : [""];
}

// Parses **bold**, *italic*/_italic_, `code`, and [text](url) inline.
export function toRichText(line: string): RichText[] {
  const tokens: RichText[] = [];
  const re = /(\*\*(.+?)\*\*|`(.+?)`|\[(.+?)\]\((.+?)\)|\*(.+?)\*|_(.+?)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (text: string) => {
    for (const part of chunk(text)) {
      if (part) tokens.push({ type: "text", text: { content: part } });
    }
  };

  while ((match = re.exec(line))) {
    if (match.index > lastIndex) pushPlain(line.slice(lastIndex, match.index));

    if (match[2] !== undefined) {
      tokens.push({ type: "text", text: { content: match[2] }, annotations: { bold: true } });
    } else if (match[3] !== undefined) {
      tokens.push({ type: "text", text: { content: match[3] }, annotations: { code: true } });
    } else if (match[4] !== undefined) {
      tokens.push({
        type: "text",
        text: { content: match[4], link: { url: match[5] } },
      });
    } else if (match[6] !== undefined) {
      tokens.push({ type: "text", text: { content: match[6] }, annotations: { italic: true } });
    } else if (match[7] !== undefined) {
      tokens.push({ type: "text", text: { content: match[7] }, annotations: { italic: true } });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length) pushPlain(line.slice(lastIndex));
  if (tokens.length === 0) tokens.push({ type: "text", text: { content: "" } });
  return tokens;
}

export function markdownToBlocks(markdown: string | null | undefined): NotionBlock[] {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: NotionBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({
        object: "block",
        type: "code",
        code: {
          language: lang,
          rich_text: [{ type: "text", text: { content: codeLines.join("\n").slice(0, NOTION_TEXT_LIMIT) } }],
        },
      });
      continue;
    }

    // Headings
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const type = level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
      blocks.push({ object: "block", type, [type]: { rich_text: toRichText(heading[2]) } });
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: { rich_text: toRichText(line.replace(/^>\s?/, "")) },
      });
      i++;
      continue;
    }

    // Checkbox list item
    const checkbox = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (checkbox) {
      blocks.push({
        object: "block",
        type: "to_do",
        to_do: { rich_text: toRichText(checkbox[2]), checked: checkbox[1].toLowerCase() === "x" },
      });
      i++;
      continue;
    }

    // Bullet list item
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: toRichText(bullet[1]) },
      });
      i++;
      continue;
    }

    // Numbered list item
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: toRichText(numbered[1]) },
      });
      i++;
      continue;
    }

    // Default: paragraph (accumulate consecutive plain lines into one block)
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: toRichText(paraLines.join(" ")) },
    });
  }

  return blocks;
}

export function paragraph(text: string): NotionBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: toRichText(text) } };
}

export function heading2(text: string): NotionBlock {
  return { object: "block", type: "heading_2", heading_2: { rich_text: toRichText(text) } };
}

export function bulleted(text: string): NotionBlock {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: toRichText(text) } };
}
