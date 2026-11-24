// FDY-445 (CC-BRAND-MASTHEAD-1.0): the Daily Challenge icon-dropdown nav now lives in the shared
// Faraday AppBar (src/lib/faraday-masthead), directly under the masthead, on surface-warm #EEE6DA
// instead of the old forest header. ONE copy of the `.dc-*` nav CSS, used by both mastheads
// (SiteHeaderNav.tsx on the standalone routes and HeaderIconNav in DailyChallenge.jsx); the
// message dock (messaging/MessageDock.tsx) reuses the same trigger/dropdown classes.
//
// Colours (asserted in scripts/contrast-check.mjs, WCAG 2.1 AA):
//   trigger glyph  forest  #1C3424 on surface-warm #EEE6DA  10.8:1 (non-text, min 3)
//   caret          ink/0.7 #55524D on surface-warm          6.3:1  (non-text, min 3)
//   unread dot     deep amber #94560A on surface-warm       4.7:1  (non-text, min 3; gold #C4922A is 2.3:1)
//   dropdown       forest panel: items warm-white 12.3:1, labels sage 5.1:1, hover/current gold-light 5.3:1
//
// Layout notes:
//   • Both DC AppBars pass `overflow="visible"` (faraday-masthead 1.1.0, class `fm-appbar--menus`):
//     the default AppBar row is a horizontal scroller, which would clip the absolutely-positioned
//     dropdowns at the bar's bottom edge (FDY-460 replaced the local override that did this).
//   • The wrapper is the sticky element (the masthead scrolls away, the nav stays), z-index 30 so the
//     masthead's own narrow-screen menu (z-index 40) still opens over it.

export const DC_GOLD = "#C4922A";
export const DC_FOREST = "#1C3424";
export const DC_GOLD_LIGHT = "#DAB050";
export const DC_SAGE = "#8CA68A";
export const DC_WARM_WHITE = "#F8F5F0";
export const DC_DEEP_AMBER = "#94560A";
export const DC_CARET = "#55524D"; // ink #141210 at 0.7 over surface-warm #EEE6DA, flattened

export const DC_NAV_CSS = `
  .dc-appbar { position:sticky; top:0; z-index:30; }
  .dc-appbar-row { margin-left:auto; display:flex; align-items:center; gap:2px; }
  .dc-iconrow { display:flex; align-items:center; gap:2px; }
  .dc-navwrap { position:relative; display:flex; flex-direction:column; align-items:center; }
  .dc-trigger { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:4px; min-width:44px; min-height:44px; padding:4px 6px; border-radius:6px;
    background:none; border:none; cursor:pointer; -webkit-tap-highlight-color:transparent; }
  .dc-trigger:hover, .dc-navwrap.open .dc-trigger { background:rgba(28,52,36,0.08); box-shadow:inset 0 -3px 0 ${DC_GOLD}; }
  .dc-badge-dot { position:absolute; top:6px; right:8px; width:7px; height:7px;
    border-radius:50%; background:${DC_DEEP_AMBER}; }
  .dc-trigger svg { width:19px; height:19px; stroke:${DC_FOREST}; fill:none; }
  .dc-caret { width:6px; height:6px; border-right:1.4px solid ${DC_CARET};
    border-bottom:1.4px solid ${DC_CARET}; transform:rotate(45deg); margin-top:-2px;
    transition:transform .15s, border-color .15s; }
  .dc-navwrap.open .dc-caret { transform:rotate(-135deg); border-color:${DC_FOREST}; }
  .dc-dd { position:absolute; top:calc(100% + 4px); right:-4px; text-align:left;
    background:${DC_FOREST}; border:1px solid rgba(196,146,42,0.35); border-radius:8px;
    min-width:174px; padding:6px; box-shadow:0 12px 28px rgba(20,18,16,0.4);
    opacity:0; visibility:hidden; transform:translateY(-4px);
    transition:opacity .15s ease, transform .15s ease; z-index:60; }
  .dc-navwrap.open .dc-dd { opacity:1; visibility:visible; transform:translateY(0); }
  .dc-dd-label { font-family:'IBM Plex Mono',monospace; font-size:8.5px; letter-spacing:0.12em;
    color:${DC_SAGE}; text-transform:uppercase; padding:6px 10px 4px; }
  .dc-dd-item { display:block; width:100%; text-align:left; font-family:'IBM Plex Mono',monospace;
    font-size:11px; color:${DC_WARM_WHITE}; text-decoration:none; padding:8px 10px; border-radius:5px;
    background:none; border:none; cursor:pointer; }
  .dc-dd-item:hover, .dc-dd-item:focus-visible { background:rgba(196,146,42,0.15); color:${DC_GOLD_LIGHT}; }
  .dc-dd-item.current { color:${DC_GOLD_LIGHT}; }
  .dc-dd-item.disabled, .dc-dd-item.disabled:hover { background:none; color:rgba(238,230,218,0.32); cursor:default; }
  .dc-dd hr { border:none; border-top:1px solid rgba(238,230,218,0.1); margin:4px 6px; }
  .dc-ctx { display:flex; align-items:center; gap:14px; min-width:0; }
  .dc-status:hover { color:${DC_GOLD_LIGHT} !important; }
  @media (max-width:639px){ .dc-ctx { flex-direction:column; align-items:flex-end; gap:8px; } }
  @media (prefers-reduced-motion: reduce){
    .dc-dd, .dc-caret { transition:none; }
  }
`;
