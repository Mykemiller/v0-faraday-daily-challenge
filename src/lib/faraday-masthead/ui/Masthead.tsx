"use client";
// faraday-masthead · ui/Masthead.tsx (FDY-444). The shared Faraday masthead + AppBar for React 18 and 19.
// Emits the SAME tree as core.renderMastheadHtml / renderAppBarHtml (test/render.test.mjs compares them byte for byte).
// SSR-safe: no window/document access during render; the narrow-screen menu state lives in useState and its
// document listeners attach in an effect. No runtime dependency beyond React.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_SKIP_TARGET, FONTS_HREF, MASTHEAD_CSS, MASTHEAD_VERSION, initialOf, type AppBarLink,
} from "../core.ts";

export interface MastheadProps {
  /** app_registry.name, e.g. "Jurisdiction Watch". */
  appName: string;
  /** Where the mark and wordmark link: the app's own home. Default "/". */
  homeHref?: string;
  /** Signed-in email; shown truncated. Absent = a "Sign in" control. */
  email?: string | null;
  /** href for the default "Sign in" link. Default "/sign-in". */
  signInHref?: string;
  /** When given, "Sign in" is a button that calls this instead of a link (e.g. the gate opens its sign-in panel). */
  onSignIn?: () => void;
  /** Replaces the whole sign-in control (e.g. an app's own account menu). Ignored when `email` is set. */
  signIn?: ReactNode;
  /** Extra compact items placed before the app name (Daily Challenge: handle + score chips; Workbench: Owner). */
  context?: ReactNode;
  /** id of the main content element the skip link targets. Default "main". */
  skipTo?: string;
  /** Render the <style> block (default true). Turn off only if the page already includes MASTHEAD_CSS. */
  includeStyles?: boolean;
  /** Render the Google Fonts <link> (default false; most apps already load the three families). */
  loadFonts?: boolean;
}

/** Stylesheet once per page. Safe to render more than once (identical rules). */
export function MastheadStyles({ loadFonts = false }: { loadFonts?: boolean }) {
  return (
    <>
      {loadFonts ? <link rel="stylesheet" href={FONTS_HREF} /> : null}
      <style data-fm-css={MASTHEAD_VERSION} dangerouslySetInnerHTML={{ __html: MASTHEAD_CSS }} />
    </>
  );
}

export function Masthead(props: MastheadProps) {
  const {
    appName, homeHref = "/", email, signInHref = "/sign-in", onSignIn, signIn, context,
    skipTo = DEFAULT_SKIP_TARGET, includeStyles = true, loadFonts = false,
  } = props;
  const [open, setOpen] = useState(false);
  const ctxRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    const onDoc = (e: MouseEvent) => { if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onDoc);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onDoc); };
  }, [open]);

  const who = email
    ? <span className="fm-user" title={email}>{email}</span>
    : signIn
      ? signIn
      : onSignIn
        ? <button type="button" className="fm-signin" onClick={onSignIn}>Sign in</button>
        : <a className="fm-signin" href={signInHref}>Sign in</a>;

  return (
    <>
      {includeStyles ? <MastheadStyles loadFonts={loadFonts} /> : null}
      <header className="fm" role="banner" data-fm={MASTHEAD_VERSION}>
        <a className="fm-skip" href={`#${skipTo}`}>Skip to content</a>
        <div className="fm-bar">
          <a className="fm-markl" href={homeHref} tabIndex={-1} aria-hidden="true"><span className="fm-mark">F</span></a>
          <a className="fm-word" href={homeHref} aria-label="Faraday home">Faraday</a>
          <div className="fm-ctx" data-open={open ? "true" : "false"} ref={ctxRef}>
            <button type="button" className="fm-avatar" aria-expanded={open ? "true" : "false"} aria-controls="fm-panel" aria-label="Open menu" ref={btnRef} onClick={() => setOpen((v) => !v)}>{initialOf(email, appName)}</button>
            <div className="fm-panel" id="fm-panel">{context}<span className="fm-app">{appName}</span>{who}</div>
          </div>
        </div>
      </header>
    </>
  );
}

export interface AppBarProps {
  /** Accessible name for the nav landmark; usually the app name. */
  label: string;
  links?: AppBarLink[];
  /** Anything else the app's navigation needs (dropdowns, buttons). Rendered after `links`. */
  children?: ReactNode;
}

/** The app's own navigation, directly under the masthead: surface-warm, ink text, 48 px. */
export function AppBar({ label, links = [], children }: AppBarProps) {
  return (
    <nav className="fm-appbar" aria-label={label}>
      <div className="fm-appbar-in">
        {links.map((l) => (
          <a key={`${l.href}|${l.label}`} className="fm-applink" href={l.href} aria-current={l.current ? "page" : undefined}>{l.label}</a>
        ))}
        {children}
      </div>
    </nav>
  );
}

export default Masthead;
