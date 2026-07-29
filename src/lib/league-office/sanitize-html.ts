// League Office — strict server-side HTML sanitizer for Announcement bodies.
//
// NON-NEGOTIABLE (per ticket): the broadcast body is rich text, so it is
// sanitized on the SERVER at WRITE time with a hard allowlist. Nothing here runs
// only on the client, and nothing reaches dangerouslySetInnerHTML that has not
// been through sanitizeHtml(). The stored body_html IS the sanitized output —
// the raw payload is never persisted.
//
// Policy:
//   tags   p, br, strong, b, em, i, u, ul, ol, li, a          (everything else STRIPPED)
//   attrs  a[href, title]                                      (everything else dropped)
//   href   https: and mailto: only                             (anything else dropped)
//
// Disallowed tags are STRIPPED (tag removed, inner text kept) rather than
// escaped — except the script-bearing set below, whose CONTENT is dropped too so
// `<script>alert(1)</script>` leaves nothing at all behind.
//
// Hand-rolled deliberately: this project ships zero runtime dependencies beyond
// next/react/react-dom, and the allowlist is small enough that a strict parser is
// cheaper than the supply-chain surface of a sanitizer package.

/** Ticket cap: reject payloads over 2,000 characters (measured on the RAW input). */
export const MAX_BODY_CHARS = 2000;

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a",
]);

/** Only `a` carries attributes, and only these two. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
};

const VOID_TAGS = new Set(["br"]);

/** Tags whose CONTENT is dropped along with the tag — text inside them is code,
 *  markup or data, never prose the author meant to publish. */
const DROP_CONTENT_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "noscript",
  "template", "svg", "math", "xmp", "noembed", "noframes", "title",
]);

/** Schemes an `a[href]` may use. Everything else (javascript:, data:, vbscript:,
 *  file:, relative paths) loses the attribute — the anchor text survives. */
const ALLOWED_SCHEMES = [/^https:\/\//i, /^mailto:/i];

/** Runaway-nesting backstop; deeper allowed tags are stripped, content kept. */
const MAX_DEPTH = 32;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'",
};

/** Decode the entity forms a browser would resolve, so an obfuscated scheme
 *  (`&#106;avascript:`) is checked in its decoded form, not its literal one.
 *  Unknown named entities are left alone and get re-escaped on output. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);?/gi, (whole, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith("#x")) {
      const cp = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? safeFromCodePoint(cp, whole) : whole;
    }
    if (key.startsWith("#")) {
      const cp = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? safeFromCodePoint(cp, whole) : whole;
    }
    return NAMED_ENTITIES[key] ?? whole;
  });
}

function safeFromCodePoint(cp: number, fallback: string): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return fallback;
  }
}

function escapeText(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(input: string): string {
  return escapeText(input).replace(/"/g, "&quot;");
}

/** Normalize an href and return it only if its scheme is allowlisted.
 *  Control characters are stripped first — a browser ignores them when resolving
 *  the scheme, so `java\tscript:` must not slip through as an unknown scheme. */
export function safeHref(raw: string): string | null {
  const cleaned = decodeEntities(raw).replace(/[\u0000-\u0020\u007f]/g, "");
  if (!cleaned) return null;
  return ALLOWED_SCHEMES.some((re) => re.test(cleaned)) ? cleaned : null;
}

type Attr = { name: string; value: string };

/** Parse the attribute list of an open tag (already stripped of `<tag` and `>`). */
function parseAttrs(source: string): Attr[] {
  const attrs: Attr[] = [];
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? "" });
  }
  return attrs;
}

/**
 * Sanitize arbitrary HTML down to the allowlist above. Always returns
 * well-formed markup: unclosed allowed tags are closed at the end and stray
 * close tags are ignored, so the result is safe for dangerouslySetInnerHTML.
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== "string" || input === "") return "";

  const out: string[] = [];
  const stack: string[] = [];
  // When set, we are inside a drop-content tag and swallow everything until its
  // matching close tag. `skipDepth` tracks same-name nesting.
  let skipTag: string | null = null;
  let skipDepth = 0;
  let i = 0;

  const closeTag = (tag: string) => {
    const at = stack.lastIndexOf(tag);
    if (at === -1) return; // stray close tag — ignore
    for (let k = stack.length - 1; k >= at; k--) out.push(`</${stack[k]}>`);
    stack.length = at;
  };

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      if (!skipTag) out.push(escapeText(decodeEntities(input.slice(i))));
      break;
    }
    if (lt > i && !skipTag) out.push(escapeText(decodeEntities(input.slice(i, lt))));

    // Comments, doctypes, processing instructions — dropped whole.
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<!", lt) || input.startsWith("<?", lt)) {
      const end = input.indexOf(">", lt + 2);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const isClose = input.startsWith("</", lt);
    const nameStart = lt + (isClose ? 2 : 1);
    const nameMatch = /^[a-z][a-z0-9:-]*/i.exec(input.slice(nameStart));
    if (!nameMatch) {
      // A bare "<" that starts no tag — literal text.
      if (!skipTag) out.push("&lt;");
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();

    const gt = input.indexOf(">", nameStart + nameMatch[0].length);
    const tagEnd = gt === -1 ? input.length : gt + 1;
    const rawAttrs = input.slice(nameStart + nameMatch[0].length, gt === -1 ? input.length : gt);
    const selfClosing = rawAttrs.trimEnd().endsWith("/");
    i = tagEnd;

    if (skipTag) {
      // Inside a dropped subtree: track nesting, emit nothing.
      if (!isClose && tag === skipTag && !selfClosing) skipDepth++;
      else if (isClose && tag === skipTag) {
        skipDepth--;
        if (skipDepth <= 0) {
          skipTag = null;
          skipDepth = 0;
        }
      }
      continue;
    }

    if (isClose) {
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) closeTag(tag);
      continue; // disallowed close tag: stripped, nothing emitted
    }

    if (DROP_CONTENT_TAGS.has(tag)) {
      if (!selfClosing) {
        skipTag = tag;
        skipDepth = 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) continue; // strip the tag, keep the content

    if (VOID_TAGS.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }

    if (stack.length >= MAX_DEPTH) continue; // too deep: strip tag, keep content

    // Allowed tag: emit it with only its allowlisted attributes.
    const allowed = ALLOWED_ATTRS[tag];
    let rendered = `<${tag}`;
    if (allowed) {
      for (const attr of parseAttrs(rawAttrs.replace(/\/\s*$/, ""))) {
        if (!allowed.has(attr.name)) continue;
        if (attr.name === "href") {
          const href = safeHref(attr.value);
          if (href) rendered += ` href="${escapeAttr(href)}"`;
          continue;
        }
        rendered += ` ${attr.name}="${escapeAttr(decodeEntities(attr.value))}"`;
      }
      // Any link we keep leaves this origin — make that safe and explicit.
      if (tag === "a" && rendered.includes(" href=")) {
        rendered += ' target="_blank" rel="noopener noreferrer nofollow"';
      }
    }
    if (selfClosing) {
      out.push(`${rendered}></${tag}>`);
      continue;
    }
    out.push(`${rendered}>`);
    stack.push(tag);
  }

  for (let k = stack.length - 1; k >= 0; k--) out.push(`</${stack[k]}>`);
  return out.join("");
}

/** Derive the plaintext fallback FROM THE SANITIZED HTML (never from the raw
 *  input) so body_text can never carry markup the html no longer contains. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol)>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type SanitizedBody = { html: string; text: string };

export type SanitizeResult =
  | { ok: true; body: SanitizedBody }
  | { ok: false; message: string };

/** The one entry point the write path uses: validates length, sanitizes, and
 *  derives the plaintext. Rejects a body that is empty once sanitized (e.g. a
 *  payload that was nothing but script). */
export function sanitizeBroadcastBody(raw: unknown): SanitizeResult {
  if (typeof raw !== "string" || raw.trim() === "")
    return { ok: false, message: "A message body is required." };
  if (raw.length > MAX_BODY_CHARS)
    return {
      ok: false,
      message: `Message is too long — ${raw.length.toLocaleString()} characters (max ${MAX_BODY_CHARS.toLocaleString()}).`,
    };

  const html = sanitizeHtml(raw);
  const text = htmlToText(html);
  if (!text) return { ok: false, message: "The message is empty after sanitizing." };
  return { ok: true, body: { html, text } };
}
