import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontMatter, parseInline, parseBlocks, parseLegalDoc, toPlainText } from "./markdown.ts";

test("front matter: parses keys, keeps colons inside values, strips quotes", () => {
  const { meta, body } = parseFrontMatter(
    ['---', 'title: Master Terms', 'canonicalUrl: https://x.test/terms', 'effective: "TODO(myke): later"', '---', 'Body.'].join("\n"),
  );
  assert.equal(meta.title, "Master Terms");
  assert.equal(meta.canonicalUrl, "https://x.test/terms");
  assert.equal(meta.effective, "TODO(myke): later");
  assert.equal(body.trim(), "Body.");
});

test("front matter: absent front matter returns the whole source as body", () => {
  const { meta, body } = parseFrontMatter("Just prose.");
  assert.deepEqual(meta, {});
  assert.equal(body, "Just prose.");
});

test("inline: strong, code and links", () => {
  assert.deepEqual(parseInline("a **b** c"), [
    { t: "text", v: "a " },
    { t: "strong", v: "b" },
    { t: "text", v: " c" },
  ]);
  assert.deepEqual(parseInline("see [terms](/terms) now"), [
    { t: "text", v: "see " },
    { t: "link", v: "terms", href: "/terms" },
    { t: "text", v: " now" },
  ]);
  assert.deepEqual(parseInline("`TODO(myke)`"), [{ t: "code", v: "TODO(myke)" }]);
});

test("inline: a bare asterisk is literal text, never a crash", () => {
  assert.deepEqual(parseInline("5 * 3"), [{ t: "text", v: "5 * 3" }]);
});

test("blocks: headings, and the document h1 is dropped (chrome renders the title)", () => {
  const blocks = parseBlocks("# Title\n\n## Section\n\n### Sub");
  assert.deepEqual(
    blocks.map((b) => b.t),
    ["h2", "h3"],
  );
});

test("blocks: soft-wrapped paragraph lines join with a space", () => {
  const [block] = parseBlocks("one two\nthree four");
  assert.equal(block.t, "p");
  assert.equal(toPlainText([block]), "one two three four");
});

test("blocks: ordered and unordered lists, with indented continuations", () => {
  const blocks = parseBlocks("- alpha\n  still alpha\n- beta\n\n1. one\n2. two");
  assert.deepEqual(blocks.map((b) => b.t), ["ul", "ol"]);
  const ul = blocks[0];
  assert.equal(ul.t === "ul" && ul.items.length, 2);
  assert.equal(toPlainText([blocks[0]]), "alpha still alpha\nbeta");
});

test("blocks: a blank line between items keeps one list", () => {
  const blocks = parseBlocks("- a\n\n- b\n\n- c");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].t === "ul" && blocks[0].items.length, 3);
});

test("blocks: blockquote becomes a note that can hold its own heading and list", () => {
  const blocks = parseBlocks("> ## NOTICE\n>\n> Body line.\n>\n> - point one\n\nAfter.");
  assert.equal(blocks[0].t, "note");
  const note = blocks[0];
  assert.ok(note.t === "note");
  assert.deepEqual(note.blocks.map((b) => b.t), ["h2", "p", "ul"]);
  assert.equal(blocks[1].t, "p");
  assert.equal(toPlainText([blocks[1]]), "After.");
});

test("blocks: html comments are stripped and never rendered", () => {
  const blocks = parseBlocks("<!--\n  secret note\n-->\nVisible.");
  assert.equal(toPlainText(blocks).includes("secret"), false);
  assert.equal(toPlainText(blocks).trim(), "Visible.");
});

test("parseLegalDoc: front matter and body together", () => {
  const doc = parseLegalDoc("---\ntitle: T\nstatus: DRAFT\n---\n\n## One\n\nText.");
  assert.equal(doc.meta.status, "DRAFT");
  assert.deepEqual(doc.blocks.map((b) => b.t), ["h2", "p"]);
});
