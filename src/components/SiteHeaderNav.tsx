"use client";

// ══════════════════════════════════════════════════════════════════════════════
// SiteHeaderNav — icon-dropdown masthead for the standalone Next routes
// (/account, /leaderboard, …). Visual + behavioural twin of the in-app
// `HeaderIconNav` in DailyChallenge.jsx, but navigation uses real hrefs instead
// of in-app screen state, so it can live on any server-rendered page.
//
// EDIT MENU TEXT + LINKS in `buildSiteMenus()` below — the single source of truth
// for these pages (mirrors the in-app `buildHeaderMenus`). Icons are inline SVG
// (stroke 1.8, no icon library); styling is the shared `.dc-*` classes injected
// once per document via `useNavStyles`.

import { useEffect, useRef, useState } from "react";

const C = {
  forest: "#1C3424",
  gold:   "#C4922A",
  cream:  "#EEE6DA",
  white:  "#F8F5F0",
  sage:   "#8CA68A",
} as const;

const serif = { fontFamily: "'IBM Plex Serif',serif" } as const;
const mono  = { fontFamily: "'IBM Plex Mono',monospace" } as const;

type MenuItem =
  | { label: string; href: string; current?: boolean }
  | { label: string; onClick: () => void; current?: boolean }
  | { label: string; disabled: true }
  | { divider: true }
  | { heading: string };

interface Menu {
  id: string;
  icon: "grid" | "help" | "trophy" | "gear" | "hamburger";
  label: string;
  items: MenuItem[];
}

// Inline SVGs for the five triggers — grid · help · trophy · gear · hamburger.
function NavGlyph({ name }: { name: Menu["icon"] }) {
  const common = { viewBox: "0 0 24 24", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "grid") return (
    <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  );
  if (name === "help") return (
    <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
  );
  if (name === "trophy") return (
    <svg {...common}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M7 6H4a2 2 0 0 0 2 4M17 6h3a2 2 0 0 1-2 4" /></svg>
  );
  if (name === "gear") return (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  );
  return ( // hamburger
    <svg {...common}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
  );
}

// The 7 daily games in lobby-grid order. Keep in sync with GAME_CONFIGS in
// DailyChallenge.jsx (the lobby's source of truth) — each links via the
// /challenge?game=<type> deep-link that the lobby already honours on mount.
const DC_GAMES = ["Rackl", "Circuit", "Dark Fiber", "Frequency", "The Stack", "Signal Drop", "The Brief"] as const;

// ── EDIT MENU TEXT + LINKS HERE ───────────────────────────────────────────────
// Single source of truth for the standalone-page header dropdowns. Each item is
// one of: { label, href } · { label, onClick } · { …, current:true } ·
// { label, disabled:true } · { divider }. The Account menu is auth-conditional.
// `current` marks the active destination for the page this header renders on.
// Mirrors buildHeaderMenus in DailyChallenge.jsx — keep the two in sync.
export function buildSiteMenus({
  authed,
  current,
  onSignOut,
}: {
  authed: boolean;
  current?: "daily" | "leaderboard" | "account" | "notifications";
  onSignOut?: () => void;
}): Menu[] {
  return [
    { id: "games", icon: "grid", label: "All Games", items:
      DC_GAMES.map(g => ({ label: g, href: `/challenge?game=${encodeURIComponent(g)}` })),
    },
    { id: "help", icon: "help", label: "Help & Feedback", items: [
      // Evergreen "Hints" (general how-to-play help) stays as-is — the
      // day-scoped "Hints Today" below is a distinct page (FAR-287).
      { label: "Hints",           href: "/help/hints" },
      { label: "Tips and Tricks", href: "/help/tips" },
      { label: "Questions",       href: "/help/questions" },
      { label: "Glossary",        href: "/help/glossary" },
      { label: "Report a Bug",    href: "/help/report-a-bug" },
      { label: "Feedback",        href: "/help/feedback" },
      { divider: true },
      { heading: "Today's Challenge" },
      { label: "Hints Today",             href: "/challenge/hints" },
      { label: "About Today's Challenge", href: "/challenge/about" },
      { label: "Answers Today",           href: "/challenge/answers" },
    ]},
    { id: "compete", icon: "trophy", label: "Compete", items: [
      { label: "Leaderboard — Today",  href: "/leaderboard", current: current === "leaderboard" },  // TODO: no today-only view yet → season board (shows a Today column)
      { label: "Leaderboard — Season", href: "/leaderboard" },
      { label: "Teams",                href: "/leaderboard?view=teams" },
      { label: "Free Agency",          href: "/free-agency" },
    ]},
    { id: "account", icon: "gear", label: "Account", items: authed ? [
      { label: "Account",  href: "/account", current: current === "account" },
      { label: "Settings", href: "/account" },  // same Account page today — no separate settings page yet
      { label: "Notifications", href: "/account/notifications", current: current === "notifications" },
      { divider: true },
      ...(onSignOut ? [{ label: "Sign Out", onClick: onSignOut } as MenuItem] : []),
    ] : [
      { label: "Sign In", href: "/account" },
    ]},
    { id: "menu", icon: "hamburger", label: "More Faraday", items: [
      { label: "About Faraday Intelligence", href: "/about" },
      { label: "Who is Faraday",             href: "/who-is-faraday" },
      { label: "Share / Invite",             href: "/share" },
      { label: "Notifications",              href: "/account/notifications" },
      { label: "Faraday Merchandise",        href: "/merch" },
      { label: "Faraday Academy",            disabled: true },  // reserved for a later phase — no link by design
      { divider: true },
      { label: "Terms / Privacy",            href: "/legal" },
    ]},
  ];
}

const NAV_STYLE_ID = "dc-sitenav-styles";
const NAV_CSS = `
  .dc-navwrap { position:relative; display:flex; flex-direction:column; align-items:center; }
  .dc-trigger { display:flex; flex-direction:column; align-items:center; gap:5px;
    background:none; border:none; cursor:pointer; padding:4px 2px; -webkit-tap-highlight-color:transparent; }
  .dc-trigger svg { width:19px; height:19px; stroke:rgba(238,230,218,0.62); fill:none; transition:stroke .12s; }
  .dc-navwrap.open .dc-trigger svg, .dc-trigger:hover svg { stroke:${C.gold}; }
  .dc-caret { width:6px; height:6px; border-right:1.4px solid rgba(238,230,218,0.35);
    border-bottom:1.4px solid rgba(238,230,218,0.35); transform:rotate(45deg); margin-top:-1px;
    transition:transform .15s, border-color .15s; }
  .dc-navwrap.open .dc-caret { transform:rotate(-135deg); border-color:${C.gold}; }
  .dc-dd { position:absolute; top:calc(100% + 12px); right:-8px; text-align:left;
    background:${C.forest}; border:1px solid rgba(196,146,42,0.35); border-radius:8px;
    min-width:174px; padding:6px; box-shadow:0 12px 28px rgba(20,18,16,0.4);
    opacity:0; visibility:hidden; transform:translateY(-4px);
    transition:opacity .15s ease, transform .15s ease; z-index:60; }
  .dc-navwrap.open .dc-dd { opacity:1; visibility:visible; transform:translateY(0); }
  .dc-dd-label { font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:0.12em;
    color:rgba(238,230,218,0.4); text-transform:uppercase; padding:6px 10px 4px; }
  .dc-dd-item { display:block; width:100%; text-align:left; font-family:'IBM Plex Mono',monospace;
    font-size:11px; color:${C.cream}; text-decoration:none; padding:8px 10px; border-radius:5px;
    background:none; border:none; cursor:pointer; }
  .dc-dd-item:hover, .dc-dd-item:focus-visible { background:rgba(196,146,42,0.15); color:${C.gold}; }
  .dc-dd-item.current { color:${C.gold}; }
  .dc-dd-item.disabled, .dc-dd-item.disabled:hover { background:none; color:rgba(238,230,218,0.32); cursor:default; }
  .dc-dd hr { border:none; border-top:1px solid rgba(238,230,218,0.1); margin:4px 6px; }
  .dc-status:hover { color:${C.white} !important; }
  @media (max-width:430px){ .dc-status { display:none; } }
  @media (prefers-reduced-motion: reduce){
    .dc-dd, .dc-caret, .dc-trigger svg { transition:none; }
  }
`;

function useNavStyles() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(NAV_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = NAV_STYLE_ID;
    el.textContent = NAV_CSS;
    document.head.appendChild(el);
  }, []);
}

function IconNav({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function activate(item: MenuItem) {
    setOpen(null);
    if ("onClick" in item && typeof item.onClick === "function") item.onClick();
    else if ("href" in item && item.href) window.location.href = item.href;
  }

  return (
    <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: "19px" }}>
      {menus.map((m) => {
        const isOpen = open === m.id;
        return (
          <div key={m.id} className={`dc-navwrap${isOpen ? " open" : ""}`}>
            <button
              type="button"
              className="dc-trigger"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              aria-label={m.label}
              title={m.label}
              onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : m.id); }}
            >
              <NavGlyph name={m.icon} />
              <span className="dc-caret" aria-hidden="true" />
            </button>
            <div className="dc-dd" role="menu" aria-label={m.label}>
              <div className="dc-dd-label">{m.label}</div>
              {m.items.map((it, i) =>
                "divider" in it ? (
                  <hr key={i} />
                ) : "heading" in it ? (
                  <div key={i} className="dc-dd-label">{it.heading}</div>
                ) : "disabled" in it ? (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className="dc-dd-item disabled"
                    disabled
                    aria-disabled
                    title="Coming soon"
                  >
                    {it.label}
                  </button>
                ) : (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className={`dc-dd-item${it.current ? " current" : ""}`}
                    onClick={() => activate(it)}
                  >
                    {it.label}{it.current ? " ·" : ""}
                  </button>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SiteHeaderNav({
  current,
  authed = false,
  handle,
  onSignOut,
}: {
  current?: "daily" | "leaderboard" | "account" | "notifications";
  authed?: boolean;
  handle?: string | null;
  onSignOut?: () => void;
}) {
  useNavStyles();
  const menus = buildSiteMenus({ authed, current, onSignOut });

  return (
    <>
      <div style={{ height: "2px", background: C.gold }} />
      <header style={{ background: C.forest, position: "sticky", top: 0, zIndex: 50 }}>
        <div className="fdc-header-inner">
          {/* Wordmark flush left — no bounding box / icon (matches the in-app masthead). */}
          <a href="/challenge" style={{ lineHeight: 1.25, textDecoration: "none" }} aria-label="Daily Challenge">
            <b style={{ ...serif, fontWeight: 700, fontSize: "clamp(16px,1.5vw,22px)", color: C.white, letterSpacing: "0.04em" }}>Faraday</b>
            <span style={{ display: "block", ...mono, fontSize: "clamp(11px,0.85vw,13px)", letterSpacing: "0.18em", color: C.sage }}>DAILY CHALLENGE</span>
          </a>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "16px", flexWrap: "nowrap" }}>
            {handle && (
              <a
                href="/account"
                className="dc-status"
                title="Account"
                style={{ ...mono, fontSize: "clamp(12px,1vw,14px)", fontWeight: 700, color: C.gold, letterSpacing: "0.04em", textDecoration: "none", whiteSpace: "nowrap" }}
              >
                @{handle}
              </a>
            )}
            <IconNav menus={menus} />
          </div>
        </div>
      </header>
      <div style={{ height: "2px", background: C.gold }} />
    </>
  );
}
