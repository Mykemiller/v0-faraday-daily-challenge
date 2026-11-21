"use client";
// faraday-gate · ui/GatePage.tsx (FDY-414). The standard gate page. React 18 and 19.
// Brand Bible 5.0 S3 masthead comes from the shared faraday-masthead package (FDY-444): no second copy of its markup here.
// Tokens only. No prices, no counts, no stock photography. Copy comes from gate-copy/<access_key>.json and shows
// neutral text until its status is "approved".
import { useState, type CSSProperties, type FormEvent } from "react";
import { COMMERCIAL_LINE, displayCopy, type GateCopy, type GateView } from "../core.ts";
import { Masthead } from "../../faraday-masthead/ui/Masthead.tsx";

const T = {
  forest: "#1C3424", forestMid: "#244228", forestLight: "#325638", gold: "#C4922A", goldLight: "#DAB050",
  surface: "#F8F5F0", surfaceWarm: "#EEE6DA", ink: "#141210", sage: "#8CA68A", alert: "#B8710A", neutral: "#B2A898",
};
const SERIF = "'IBM Plex Serif', Georgia, serif";
const BODY = "'Bricolage Grotesque', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

export interface GatePageProps {
  app: string;              // access_key, e.g. "jw"
  appName: string;          // e.g. "Jurisdiction Watch"
  version?: string | null;  // from app_registry, e.g. "3.4"
  copy?: GateCopy | null;
  view: GateView;           // request | expired | waitlist | unavailable
  email?: string | null;    // signed-in email, if any
  apiBase?: string;         // default /api/faraday-gate
  termsUrl?: string;
  privacyUrl?: string;
}

type Panel = null | "demo" | "waitlist" | "signin";

const btn = (primary: boolean): CSSProperties => ({
  minHeight: 44, padding: "0 20px", borderRadius: 6, cursor: "pointer", fontFamily: BODY, fontSize: 16, fontWeight: 600,
  border: `2px solid ${primary ? T.gold : T.forest}`, background: primary ? T.gold : "transparent", color: primary ? T.ink : T.forest,
});
const input: CSSProperties = {
  width: "100%", minHeight: 44, padding: "10px 12px", borderRadius: 6, border: `1px solid ${T.neutral}`,
  fontFamily: BODY, fontSize: 16, color: T.ink, background: "#fff", boxSizing: "border-box",
};
const label: CSSProperties = { display: "block", fontFamily: BODY, fontSize: 14, fontWeight: 600, color: T.ink, margin: "12px 0 6px" };

export default function GatePage(props: GatePageProps) {
  const { app, appName, version, copy, view, email, apiBase = "/api/faraday-gate", termsUrl = "/terms", privacyUrl = "/privacy" } = props;
  const text = displayCopy(copy, appName);
  const [panel, setPanel] = useState<Panel>(null);
  const [addr, setAddr] = useState(email || "");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(action: string, body: unknown) {
    const r = await fetch(`${apiBase}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin",
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j: j as { error?: string; created?: boolean } };
  }

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    if (panel !== "demo" && panel !== "waitlist") return;
    setBusy(true); setStatus(null);
    const { ok, j } = await post("request", { email: addr, kind: panel, message });
    setBusy(false);
    setStatus(ok
      ? { ok: true, text: panel === "demo" ? "Thanks. Your request is in; you will hear from us by email." : "You are on the waitlist. We will be in touch." }
      : { ok: false, text: j.error || "Something went wrong. Try again." });
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setStatus(null);
    if (!codeSent) {
      const { ok, j } = await post("code", { email: addr });
      setBusy(false);
      if (ok) { setCodeSent(true); setStatus({ ok: true, text: "We sent a code to your email. Enter it below." }); }
      else setStatus({ ok: false, text: j.error || "We could not send a code." });
      return;
    }
    const { ok, j } = await post("verify", { email: addr, code });
    setBusy(false);
    if (ok) window.location.reload();
    else setStatus({ ok: false, text: j.error || "That code did not work." });
  }

  const heading =
    view === "expired" ? "Your 14-day demo has ended"
    : view === "waitlist" ? `${text.title} is not taking new demos right now`
    : view === "unavailable" ? `${text.title} is unavailable right now`
    : text.title;

  return (
    <div style={{ minHeight: "100vh", background: T.surface, color: T.ink, fontFamily: BODY }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600&family=IBM+Plex+Mono&family=IBM+Plex+Serif:wght@500;600&display=swap" />
      <style>{`.fg-btn:focus-visible,.fg-in:focus-visible,.fg-link:focus-visible{outline:3px solid ${T.goldLight};outline-offset:2px}`}</style>
      <Masthead appName={appName} email={email} onSignIn={() => { setPanel("signin"); setStatus(null); }} skipTo="fg-main" />

      <main id="fg-main" style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 48px" }}>
        <h1 style={{ fontFamily: SERIF, fontSize: 30, lineHeight: 1.2, margin: "0 0 12px", color: T.forest }}>{heading}</h1>
        {view !== "unavailable" && <p style={{ fontSize: 17, lineHeight: 1.55, margin: "0 0 16px" }}>{text.story}</p>}
        {view === "unavailable" && <p style={{ fontSize: 17, lineHeight: 1.55 }}>We could not confirm access just now. Refresh the page in a moment.</p>}
        {text.points.length > 0 && view !== "unavailable" && (
          <ul style={{ margin: "0 0 20px", paddingLeft: 20, lineHeight: 1.6 }}>
            {text.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        {view !== "unavailable" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "8px 0 20px" }}>
            {view !== "waitlist" && (
              <button type="button" className="fg-btn" style={btn(true)} onClick={() => { setPanel("demo"); setStatus(null); }}>
                {view === "expired" ? "Ask for more time" : "Request demo access"}
              </button>
            )}
            <button type="button" className="fg-btn" style={btn(view === "waitlist")} onClick={() => { setPanel("waitlist"); setStatus(null); }}>
              Join the waitlist
            </button>
          </div>
        )}

        {(panel === "demo" || panel === "waitlist") && (
          <form onSubmit={onRequest} style={{ background: T.surfaceWarm, borderRadius: 8, padding: 16, margin: "0 0 20px" }}>
            <label style={label} htmlFor="fg-email">Email</label>
            <input id="fg-email" className="fg-in" style={input} type="email" required autoComplete="email" value={addr} onChange={(e) => setAddr(e.target.value)} />
            <label style={label} htmlFor="fg-msg">Message <span style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea id="fg-msg" className="fg-in" style={{ ...input, minHeight: 88 }} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div style={{ marginTop: 14 }}>
              <button type="submit" className="fg-btn" style={btn(true)} disabled={busy}>{busy ? "Sending…" : panel === "demo" ? "Send request" : "Join the waitlist"}</button>
            </div>
          </form>
        )}

        {panel === "signin" && (
          <form onSubmit={onSignIn} style={{ background: T.surfaceWarm, borderRadius: 8, padding: 16, margin: "0 0 20px" }}>
            <label style={label} htmlFor="fg-si-email">Email</label>
            <input id="fg-si-email" className="fg-in" style={input} type="email" required autoComplete="email" value={addr} onChange={(e) => setAddr(e.target.value)} disabled={codeSent} />
            {codeSent && (
              <>
                <label style={label} htmlFor="fg-code">Code from the email</label>
                <input id="fg-code" className="fg-in" style={input} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </>
            )}
            <div style={{ marginTop: 14 }}>
              <button type="submit" className="fg-btn" style={btn(true)} disabled={busy}>{busy ? "Working…" : codeSent ? "Sign in" : "Email me a code"}</button>
            </div>
          </form>
        )}

        {status && (
          <p role="status" style={{ margin: "0 0 20px", fontSize: 15, color: status.ok ? T.forest : T.alert, fontWeight: 600 }}>{status.text}</p>
        )}

        <p style={{ fontSize: 15, lineHeight: 1.5, color: T.forestMid, borderTop: `1px solid ${T.neutral}`, paddingTop: 16 }}>{COMMERCIAL_LINE}</p>
      </main>

      <footer style={{ borderTop: `3px solid ${T.gold}`, background: T.forest, color: T.surface, padding: "14px 16px", fontSize: 13, display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
        <a className="fg-link" href={termsUrl} style={{ color: T.surface, minHeight: 24 }}>Terms</a>
        <a className="fg-link" href={privacyUrl} style={{ color: T.surface, minHeight: 24 }}>Privacy</a>
        {version ? <span style={{ fontFamily: MONO, color: T.sage }}>{appName} v{version}</span> : null}
        <span style={{ display: "none" }} data-app={app} />
      </footer>
    </div>
  );
}
