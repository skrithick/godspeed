import type { JSONContent } from "@tiptap/core";
import { decodeHTML } from "entities";
import { Lexer, type Token, type Tokens } from "marked";
import { paragraph } from "./model";
import { publicWebLink } from "./web-link";

type Marks = NonNullable<JSONContent["marks"]>;
const text = (value: string, marks: Marks = []): JSONContent[] =>
  value ? [{ type: "text", text: value, ...(marks.length ? { marks } : {}) }] : [];

function inline(tokens: Token[], marks: Marks = [], depth = 0): JSONContent[] {
  return tokens.flatMap((t): JSONContent[] => {
    if (depth > 14) return text(t.raw, marks);
    const add = (mark: Marks[number]) => [...marks.filter((m) => m.type !== mark.type), mark];
    switch (t.type) {
      case "strong": case "em": case "del": {
        const token = t as Tokens.Strong | Tokens.Em | Tokens.Del;
        return inline(token.tokens, add({ type: t.type === "strong" ? "bold" : t.type === "em" ? "italic" : "strike" }), depth + 1);
      }
      case "link": {
        const token = t as Tokens.Link;
        const href = publicWebLink(token.autolink ? token.href : decodeHTML(token.href));
        return inline(token.tokens, href ? add({ type: "link", attrs: { href } }) : marks, depth + 1);
      }
      case "image": return text(decodeHTML((t as Tokens.Image).text), marks);
      case "codespan": return text((t as Tokens.Codespan).text, [{ type: "code" }]);
      case "br": return [{ type: "hardBreak" }];
      case "escape": return text((t as Tokens.Escape).text, marks);
      case "text": {
        const token = t as Tokens.Text;
        return token.tokens ? inline(token.tokens, marks, depth + 1) : text(token.escaped ? token.text : decodeHTML(token.text), marks);
      }
      default: return text(t.raw, marks); // HTML is literal text, never injected.
    }
  });
}

function blocks(tokens: Token[], depth = 0): JSONContent[] {
  return tokens.flatMap((t): JSONContent[] => {
    if (depth > 10) return [paragraph(t.raw)];
    switch (t.type) {
      case "space": case "def": return [];
      case "heading": {
        const token = t as Tokens.Heading;
        return [{ type: "heading", attrs: { level: token.depth }, content: inline(token.tokens) }];
      }
      case "paragraph": case "text": {
        const token = t as Tokens.Paragraph | Tokens.Text;
        return [{ type: "paragraph", content: token.tokens ? inline(token.tokens) : text(decodeHTML(token.text)) }];
      }
      case "blockquote": {
        const content = blocks((t as Tokens.Blockquote).tokens, depth + 1);
        return [{ type: "blockquote", content: content.length ? content : [paragraph("")] }];
      }
      case "code": {
        const token = t as Tokens.Code;
        return [{ type: "codeBlock", attrs: { language: token.lang?.split(/\s+/)[0]?.slice(0, 80) || null }, content: text(token.text) }];
      }
      case "hr": return [{ type: "horizontalRule" }];
      case "table": {
        const token = t as Tokens.Table;
        return [{ type: "table", content: [token.header, ...token.rows].map((row, i) => ({
          type: "tableRow", content: row.map((cell) => ({
            type: i ? "tableCell" : "tableHeader", content: [{ type: "paragraph", content: inline(cell.tokens) }],
          })),
        })) }];
      }
      case "list": {
        const token = t as Tokens.List;
        const groups: JSONContent[] = [];
        token.items.forEach((item, index) => {
          const type = item.task ? "taskList" : token.ordered ? "orderedList" : "bulletList";
          if (groups.at(-1)?.type !== type) groups.push({ type, content: [],
            ...(type === "orderedList" ? { attrs: { start: Number(token.start) + index } } : {}) });
          const content = blocks(item.tokens, depth + 1);
          if (content[0]?.type !== "paragraph") content.unshift(paragraph(""));
          groups.at(-1)!.content!.push({ type: item.task ? "taskItem" : "listItem", content,
            ...(item.task ? { attrs: { checked: Boolean(item.checked) } } : {}) });
        });
        return groups;
      }
      default: return [paragraph(t.raw)];
    }
  });
}

export function markdownBlocks(markdown: string): JSONContent[] {
  const tokens = Lexer.lex(markdown, { gfm: true });
  const meaningful = tokens.filter((t) => t.type !== "space");
  const only = meaningful[0] as Tokens.Code | undefined;
  return blocks(meaningful.length === 1 && only?.type === "code" && /^(md|markdown)$/i.test(only.lang ?? "")
    ? Lexer.lex(only.text, { gfm: true }) : tokens);
}
