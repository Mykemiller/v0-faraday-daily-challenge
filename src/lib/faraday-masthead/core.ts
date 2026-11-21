// faraday-masthead · core (FDY-444, CC-BRAND-MASTHEAD-1.0). Pure: no I/O, no framework imports, safe on server and client.
// Canonical copy lives in Mykemiller/faraday-workbench/packages/faraday-masthead/. Apps vendor it as lib/faraday-masthead/
// (with VERSION and MANIFEST.json). Never edit a vendored copy: change this one, bump VERSION, run
// `node packages/faraday-masthead/scripts/build.mjs`, re-vendor; check-drift.mjs tells you if a copy drifted.
//
// Brand Bible 5.0 S3 (fixed, not a design choice): forest bar full width, 64 px (56 px under 640 px), gold 2 px rule
// above and below; Faraday mark left, "Faraday" wordmark centre, context slot right (app name + sign-in state).
// One masthead for everyone: no per-app colour, logo or layout. App navigation lives in the AppBar under it.
//
// The markup is defined ONCE, here, as `renderMastheadHtml` / `renderAppBarHtml`. ui/Masthead.tsx emits the same
// tree for React (a parity test compares the two byte for byte), and static/*.html are generated from these functions.

export const MASTHEAD_VERSION = "1.0.0";

/** Brand Bible tokens. The only colours the masthead may use. */
export const TOKENS = Object.freeze({
  forest: "#1C3424", forestMid: "#244228", forestLight: "#325638",
  gold: "#C4922A", goldLight: "#DAB050",
  surface: "#F8F5F0", surfaceWarm: "#EEE6DA", ink: "#141210",
  sage: "#8CA68A", alert: "#B8710A", neutral: "#B2A898",
});

export const FONTS = Object.freeze({
  display: "'IBM Plex Serif', Georgia, serif",
  body: "'Bricolage Grotesque', system-ui, sans-serif",
  data: "'IBM Plex Mono', ui-monospace, monospace",
});

/** Google Fonts stylesheet for the three families (apps that already load them can skip it). */
export const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600&family=IBM+Plex+Mono&family=IBM+Plex+Serif:wght@500;600&display=swap";

/** Bar heights (px). Exported so tests and apps with sticky offsets read one number. */
export const BAR_HEIGHT = 64;
export const BAR_HEIGHT_NARROW = 56;
export const RULE = 2;
export const APPBAR_HEIGHT = 48;
export const NARROW_MAX = 639; // "under 640 px"

/** The id the skip link targets by default. Apps put it on their <main>. */
export const DEFAULT_SKIP_TARGET = "main";

const t = TOKENS;

/** All masthead + AppBar CSS. Class names are prefixed `fm-` so they never collide with an app's own CSS. */
export const MASTHEAD_CSS = [
  `.fm,.fm *,.fm-appbar,.fm-appbar *{box-sizing:border-box}`,
  `.fm{position:relative;width:100%;background:${t.forest};color:${t.surface};border-top:${RULE}px solid ${t.gold};border-bottom:${RULE}px solid ${t.gold};font-family:${FONTS.body};z-index:40}`,
  `.fm-skip{position:absolute;left:8px;top:-60px;z-index:50;background:${t.goldLight};color:${t.ink};font:600 15px ${FONTS.body};padding:12px 16px;border-radius:6px;text-decoration:none;min-height:44px}`,
  `.fm-skip:focus{top:8px}`,
  `.fm-bar{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;height:${BAR_HEIGHT}px;padding:0 16px;max-width:none;margin:0}`,
  `.fm-markl{justify-self:start;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;text-decoration:none}`,
  `.fm-mark{width:34px;height:34px;border-radius:6px;background:${t.forestLight};border:1px solid ${t.gold};display:grid;place-items:center;font:600 18px/1 ${FONTS.display};color:${t.goldLight}}`,
  `.fm-word{justify-self:center;display:inline-flex;align-items:center;min-height:44px;padding:0 4px;font:600 22px/1 ${FONTS.display};letter-spacing:.5px;color:${t.surface};text-decoration:none;white-space:nowrap}`,
  `.fm-ctx{justify-self:end;position:relative;min-width:0;max-width:100%;display:flex;align-items:center}`,
  `.fm-avatar{display:none}`,
  `.fm-panel{display:flex;align-items:center;justify-content:flex-end;gap:12px;min-width:0;max-width:100%}`,
  `.fm-app{color:${t.sage};font:600 13px/1.2 ${FONTS.body};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:22ch}`,
  `.fm-user{font:12px/1.2 ${FONTS.data};color:${t.surface};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:26ch;min-width:0}`,
  `.fm-signin{display:inline-flex;align-items:center;min-height:44px;padding:0 4px;color:${t.goldLight};font:600 14px ${FONTS.body};text-decoration:underline;text-underline-offset:3px;background:none;border:0;cursor:pointer;white-space:nowrap}`,
  `.fm a:focus-visible,.fm button:focus-visible,.fm-appbar a:focus-visible,.fm-appbar button:focus-visible{outline:3px solid ${t.goldLight};outline-offset:2px;border-radius:4px}`,
  `.fm-appbar a:focus-visible,.fm-appbar button:focus-visible{box-shadow:0 0 0 5px ${t.forest}}`,
  `@media (max-width:${NARROW_MAX}px){`
    + `.fm-bar{height:${BAR_HEIGHT_NARROW}px;padding:0 8px;gap:8px}`
    + `.fm-word{font-size:20px}`
    + `.fm-avatar{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:${t.forestLight};border:1px solid ${t.gold};color:${t.goldLight};font:600 16px/1 ${FONTS.display};cursor:pointer;padding:0}`
    + `.fm-panel{display:none;position:absolute;right:0;top:calc(100% + 8px);flex-direction:column;align-items:flex-end;gap:8px;min-width:200px;max-width:calc(100vw - 16px);padding:12px;background:${t.forest};border:1px solid ${t.gold};border-radius:8px;box-shadow:0 8px 24px rgba(20,18,16,.35)}`
    + `.fm-ctx[data-open="true"] .fm-panel,.fm-ctx:focus-within .fm-panel{display:flex}`
    + `.fm-app,.fm-user{max-width:100%}`
    + `}`,
  `.fm-appbar{width:100%;background:${t.surfaceWarm};color:${t.ink};border-bottom:1px solid ${t.neutral};font-family:${FONTS.body}}`,
  `.fm-appbar-in{display:flex;align-items:center;gap:4px;min-height:${APPBAR_HEIGHT}px;padding:0 12px;overflow-x:auto;scrollbar-width:thin}`,
  `.fm-applink{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:6px;color:${t.ink};font:600 14px ${FONTS.body};text-decoration:none;white-space:nowrap}`,
  `.fm-applink:hover{background:rgba(28,52,36,.08)}`,
  `.fm-applink[aria-current="page"]{color:${t.forest};box-shadow:inset 0 -3px 0 ${t.gold}}`,
  `@media (prefers-reduced-motion:no-preference){.fm-skip{transition:top .12s ease}}`,
].join("\n");

/** Tiny progressive-enhancement script for the static version: toggles the narrow-screen menu. Optional;
 *  without it the menu still opens by keyboard focus (`:focus-within`). React does this with state instead. */
export const MASTHEAD_SCRIPT =
  "(function(){var c=document.querySelector('.fm-ctx');if(!c)return;var b=c.querySelector('.fm-avatar');if(!b)return;"
  + "b.addEventListener('click',function(){var o=c.getAttribute('data-open')==='true';c.setAttribute('data-open',o?'false':'true');b.setAttribute('aria-expanded',o?'false':'true');});"
  + "document.addEventListener('keydown',function(e){if(e.key==='Escape'&&c.getAttribute('data-open')==='true'){c.setAttribute('data-open','false');b.setAttribute('aria-expanded','false');b.focus();}});"
  + "document.addEventListener('click',function(e){if(!c.contains(e.target)){c.setAttribute('data-open','false');b.setAttribute('aria-expanded','false');}});})();";

/** HTML-escape exactly the way React does for text and attributes, so static and React output are byte-identical. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[c] as string));
}

/** The single letter shown in the narrow-screen avatar: the signed-in email's first letter, else the app's. */
export function initialOf(email: string | null | undefined, appName: string): string {
  const src = (email && email.trim()) || appName.trim() || "F";
  const ch = src.replace(/^[^A-Za-z0-9]+/, "").charAt(0) || "F";
  return ch.toUpperCase();
}

export interface MastheadOptions {
  /** app_registry.name, e.g. "Jurisdiction Watch". Shown in the context slot. */
  appName: string;
  /** Where the mark and the wordmark link: the app's own home (never another domain). Default "/". */
  homeHref?: string;
  /** Signed-in email (truncated with ellipsis). When absent the slot shows "Sign in". */
  email?: string | null;
  /** href for the "Sign in" link. Default "/sign-in". Ignored when `signInHtml` is given or `email` is set. */
  signInHref?: string;
  /** Static only: raw HTML that replaces the default sign-in link (e.g. the Workbench's own button). Trusted input. */
  signInHtml?: string;
  /** Static only: extra compact items before the app name (trusted HTML). React passes `context` instead. */
  contextHtml?: string;
  /** id of the main content element the skip link jumps to. Default "main". */
  skipTo?: string;
}

/** Opening tags up to the context items: shared by the static renderer and the parity test. */
export function mastheadOpen(o: MastheadOptions): string {
  const home = esc(o.homeHref || "/");
  const skip = esc(o.skipTo || DEFAULT_SKIP_TARGET);
  const initial = esc(initialOf(o.email, o.appName));
  return `<header class="fm" role="banner" data-fm="${MASTHEAD_VERSION}">`
    + `<a class="fm-skip" href="#${skip}">Skip to content</a>`
    + `<div class="fm-bar">`
    + `<a class="fm-markl" href="${home}" tabindex="-1" aria-hidden="true"><span class="fm-mark">F</span></a>`
    + `<a class="fm-word" href="${home}" aria-label="Faraday home">Faraday</a>`
    + `<div class="fm-ctx" data-open="false">`
    + `<button type="button" class="fm-avatar" aria-expanded="false" aria-controls="fm-panel" aria-label="Open menu">${initial}</button>`
    + `<div class="fm-panel" id="fm-panel">`;
}

/** Closing part: app name + sign-in state. */
export function mastheadClose(o: MastheadOptions): string {
  const app = `<span class="fm-app">${esc(o.appName)}</span>`;
  const who = o.email
    ? `<span class="fm-user" title="${esc(o.email)}">${esc(o.email)}</span>`
    : (o.signInHtml ?? `<a class="fm-signin" href="${esc(o.signInHref || "/sign-in")}">Sign in</a>`);
  return `${app}${who}</div></div></div></header>`;
}

/** The whole masthead as an HTML string (no <style>; include MASTHEAD_CSS once per page). */
export function renderMastheadHtml(o: MastheadOptions): string {
  return mastheadOpen(o) + (o.contextHtml || "") + mastheadClose(o);
}

export interface AppBarLink { label: string; href: string; current?: boolean; }

export interface AppBarOptions {
  /** Accessible name of the nav landmark, e.g. "Jurisdiction Watch". */
  label: string;
  links?: AppBarLink[];
  /** Static only: trusted HTML appended after the links (dropdowns, buttons). */
  extraHtml?: string;
}

export function appBarOpen(o: AppBarOptions): string {
  return `<nav class="fm-appbar" aria-label="${esc(o.label)}"><div class="fm-appbar-in">`;
}

export function appBarLinkHtml(l: AppBarLink): string {
  return `<a class="fm-applink" href="${esc(l.href)}"${l.current ? ` aria-current="page"` : ""}>${esc(l.label)}</a>`;
}

export const APPBAR_CLOSE = `</div></nav>`;

/** The AppBar (the app's own navigation, directly under the masthead) as an HTML string. */
export function renderAppBarHtml(o: AppBarOptions): string {
  return appBarOpen(o) + (o.links || []).map(appBarLinkHtml).join("") + (o.extraHtml || "") + APPBAR_CLOSE;
}

// ---- Accessibility helpers (used by tests; exported so apps can assert their own context colours) ----

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two #RRGGBB colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Every foreground/background pair the masthead and AppBar draw, with the WCAG minimum it must meet. */
export const CONTRAST_PAIRS: ReadonlyArray<{ name: string; fg: string; bg: string; min: number }> = Object.freeze([
  { name: "wordmark on forest", fg: t.surface, bg: t.forest, min: 4.5 },
  { name: "app name (sage) on forest", fg: t.sage, bg: t.forest, min: 4.5 },
  { name: "signed-in email on forest", fg: t.surface, bg: t.forest, min: 4.5 },
  { name: "sign-in link (gold-light) on forest", fg: t.goldLight, bg: t.forest, min: 4.5 },
  { name: "mark letter (gold-light) on forest-light", fg: t.goldLight, bg: t.forestLight, min: 3 },
  { name: "avatar initial (gold-light) on forest-light", fg: t.goldLight, bg: t.forestLight, min: 3 },
  { name: "skip link (ink) on gold-light", fg: t.ink, bg: t.goldLight, min: 4.5 },
  { name: "focus ring (gold-light) against forest", fg: t.goldLight, bg: t.forest, min: 3 },
  { name: "AppBar link (ink) on surface-warm", fg: t.ink, bg: t.surfaceWarm, min: 4.5 },
  { name: "AppBar current link (forest) on surface-warm", fg: t.forest, bg: t.surfaceWarm, min: 4.5 },
  { name: "AppBar focus ring (forest halo) on surface-warm", fg: t.forest, bg: t.surfaceWarm, min: 3 },
]);

/** Brand Bible G1: no prices, no counts of Theaters/Sectors/Threads/Domains, no marketing copy in the bar. */
export const FORBIDDEN_IN_BAR: ReadonlyArray<RegExp> = Object.freeze([
  /\$\s?\d/, /\b(USD|per month|\/mo)\b/i, /€|£/,
  /\b\d+\s+(theaters?|sectors?|threads?|domains?)\b/i,
  /\b(free trial|sign up now|best|#1|leading)\b/i,
]);
