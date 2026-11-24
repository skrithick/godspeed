import { expect, it } from "vitest";
import { markdownBlocks } from "./markdown";
import { recordsFor } from "./model";

it("turns generated Markdown into valid editable block records", () => {
  const content = markdownBlocks([
    "```markdown", "## Plan", "", "Use **bold** and *emphasis* &amp; [Sources](https://example.org).",
    "", "- List\n  - Nested", "- [x] Done", "", "| Item | Count |\n| --- | --- |\n| Maps | 2 |", "", "> A quote", "```",
  ].join("\n"));
  expect(recordsFor("page", { type: "doc", content }).map(({ node }) => node.type)).toEqual([
    "heading", "paragraph", "bulletList", "taskList", "table", "blockquote",
  ]);
  expect(content[1].content).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: "bold", marks: [{ type: "bold" }] }),
    expect.objectContaining({ text: " and " }),
    expect.objectContaining({ text: " & " }),
    expect.objectContaining({ text: "Sources", marks: [{ type: "link", attrs: { href: "https://example.org/" } }] }),
  ]));
  expect(content[3].content?.[0]).toMatchObject({ attrs: { checked: true } });
});

it("keeps HTML literal, preserves fenced code and strips unsafe link destinations and remote image embeds", () => {
  const content = markdownBlocks("```js\nconst name = '<script>';\n```\n\n[x](javascript:alert%281%29) ![alt](https://example.org/pixel)\n\n<div>literal</div>");
  expect(content[0]).toMatchObject({ type: "codeBlock", attrs: { language: "js" }, content: [{ text: "const name = '<script>';" }] });
  expect(JSON.stringify(content)).not.toMatch(/javascript:|https:\/\/example.org\/pixel|"marks"/);
  expect(JSON.stringify(content)).toContain("<div>literal</div>");
});
