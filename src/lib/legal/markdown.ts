// Zero-dependency markdown subset parser for the legal document set
// (CC-TOS-PRICING-1.0).
//
// WHY THIS EXISTS. The legal corpus is authored ONCE as markdown under
// `content/legal/` so that a single file is the source of truth for a document
// that is (a) rendered on the site, (b) sent to counsel, and (c) in one case
// pasted into an external LMS. Adding an MDX/remark toolchain to render it would
// break the repo's standing rule that it ships only next/react/react-dom (see
// CC-DC-LEGAL-1.0 and the sanitize-html.ts precedent — hand-rolled, zero deps).
//
// This module is PURE: it parses markdown text into a block AST and nothing
// else. Rendering lives in `src/components/legal/MarkdownBody.tsx`, so the
// parser stays testable under `node --test` without a JSX loader.
//
// SUPPORTED SUBSET — deliberately small, and the legal corpus is written to it:
//   ---front matter---   key: value (value may be quoted)
//   ## h2, ### h3
//   paragraphs (blank-line separated, soft-wrapped lines joined)
//   - unordered list items      (continuation lines indented)
//   1. ordered list items       (continuation lines indented)
//   > blockquote  -> rendered as a boxed NOTICE (used for the conspicuous
//                    auto-renewal disclosure and the counsel-review blocks);
//                    may itself contain headings, paragraphs and lists
//   `code`  **strong**  [text](url)
//   <!-- html comments --> are stripped
//
// Anything outside the subset renders as literal text rather than throwing —
// a legal page must never fail to render because of a stray character.

export type Span =
  | { t: "text"; v: string }
  | { t: "strong"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; v: string; href: string };

export type Block =
  | { t: "h2"; spans: Span[] }
  | { t: "h3"; spans: Span[] }
  | { t: "p"; spans: Span[] }
  | { t: "ul"; items: Span[][] }
  | { t: "ol"; items: Span[][] }
  | { t: "note"; blocks: Block[] };

export interface LegalDoc {
  meta: Record<string, string>;
  blocks: Block[];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** Split `---\n...\n---` front matter off the top. Missing front matter is fine. */
export function parseFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = FRONT_MATTER.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    if (!key) continue;
    let value = line.slice(at + 1).trim();
    // Strip one layer of surrounding quotes; values legitimately contain ':'
    // (URLs, and the TODO sentences we park in `effective`).
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body: src.slice(m[0].length) };
}

const INLINE = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;

/** Parse the inline subset of one logical line into spans. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) spans.push({ t: "text", v: text.slice(last, at) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      spans.push({ t: "strong", v: tok.slice(2, -2) });
    } else if (tok.startsWith("`")) {
      spans.push({ t: "code", v: tok.slice(1, -1) });
    } else {
      const close = tok.indexOf("](");
      spans.push({ t: "link", v: tok.slice(1, close), href: tok.slice(close + 2, -1) });
    }
    last = at + tok.length;
  }
  if (last < text.length) spans.push({ t: "text", v: text.slice(last) });
  return spans.length ? spans : [{ t: "text", v: "" }];
}

const UL_ITEM = /^[-*]\s+(.*)$/;
const OL_ITEM = /^\d+\.\s+(.*)$/;

/**
 * Parse a markdown body (front matter already removed) into blocks.
 * Soft-wrapped lines inside a paragraph or list item are joined with a space,
 * which is how the corpus is authored (wrapped at ~80 columns for review diffs).
 */
export function parseBlocks(body: string): Block[] {
  const lines = body.replace(HTML_COMMENT, "").split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  const flushList = (kind: "ul" | "ol", items: string[]) => {
    if (items.length) blocks.push({ t: kind, items: items.map(parseInline) });
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Blockquote -> notice box. Consume the whole run, strip the markers, and
    // parse the inner text recursively so a notice can carry its own heading
    // and list (the counsel-review blocks do).
    if (/^>\s?/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (/^>\s?/.test(lines[i]) || (inner.length > 0 && !lines[i].trim()))) {
        if (!lines[i].trim()) {
          // A blank, unquoted line ends the quote unless the next line resumes it.
          if (!/^>\s?/.test(lines[i + 1] ?? "")) break;
          inner.push("");
        } else {
          inner.push(lines[i].replace(/^>\s?/, ""));
        }
        i += 1;
      }
      blocks.push({ t: "note", blocks: parseBlocks(inner.join("\n")) });
      continue;
    }

    // Headings. `#` (document title) is dropped: the page chrome renders the
    // title from front matter, so emitting it again would double it.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      if (level >= 3) blocks.push({ t: "h3", spans: parseInline(h[2].trim()) });
      else if (level === 2) blocks.push({ t: "h2", spans: parseInline(h[2].trim()) });
      i += 1;
      continue;
    }

    // Lists. A list ends at a blank line that is not followed by another item
    // of the same kind, so the corpus can put breathing room between items.
    const isUl = UL_ITEM.test(line);
    const isOl = !isUl && OL_ITEM.test(line);
    if (isUl || isOl) {
      const kind = isUl ? "ul" : "ol";
      const re = isUl ? UL_ITEM : OL_ITEM;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = re.exec(cur);
        if (m) {
          items.push(m[1].trim());
          i += 1;
          continue;
        }
        // Indented continuation of the current item.
        if (items.length && /^\s+\S/.test(cur)) {
          items[items.length - 1] += ` ${cur.trim()}`;
          i += 1;
          continue;
        }
        // Blank line: keep going only if another item of the same kind follows.
        if (!cur.trim() && re.test(lines[i + 1] ?? "")) {
          i += 1;
          continue;
        }
        break;
      }
      flushList(kind, items);
      continue;
    }

    // Paragraph: join soft-wrapped lines until a blank line or a new construct.
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      if (
        !cur.trim() ||
        /^>\s?/.test(cur) ||
        /^#{1,6}\s+/.test(cur) ||
        UL_ITEM.test(cur) ||
        OL_ITEM.test(cur)
      ) {
        break;
      }
      para.push(cur.trim());
      i += 1;
    }
    blocks.push({ t: "p", spans: parseInline(para.join(" ")) });
  }

  return blocks;
}

/** Parse a full document (front matter + body). */
export function parseLegalDoc(src: string): LegalDoc {
  const { meta, body } = parseFrontMatter(src);
  return { meta, blocks: parseBlocks(body) };
}

/** Flatten a document's blocks to plain text — used by the drift guard. */
export function toPlainText(blocks: Block[]): string {
  const spanText = (spans: Span[]) => spans.map((s) => s.v).join("");
  const walk = (bs: Block[]): string[] =>
    bs.flatMap((b) => {
      if (b.t === "note") return walk(b.blocks);
      if (b.t === "ul" || b.t === "ol") return b.items.map(spanText);
      return [spanText(b.spans)];
    });
  return walk(blocks).join("\n");
}
