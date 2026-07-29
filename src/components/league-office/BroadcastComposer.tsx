"use client";

// League Office — Announcements composer.
//
// Minimal rich-text toolbar over a contentEditable region (bold · italic ·
// underline · link · bulleted list · numbered list). NO editor dependency was
// added: this project ships zero runtime deps beyond next/react/react-dom, and
// the allowlist the body is sanitized down to is small enough that a heavyweight
// editor would be all cost and no benefit. `document.execCommand` is formally
// deprecated but is still the only universally-supported way to do this without
// a dependency, and every byte it produces is re-parsed by the sanitizer anyway.
//
// SANITIZING: the draft is sanitized here purely so the LIVE PREVIEW can render
// it (a preview must never dangerouslySetInnerHTML unsanitized input). This is
// NOT the security boundary — executeAction("broadcast.send") re-sanitizes the
// payload server-side before it is stored, and that output is what players get.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BroadcastBannerView, type BroadcastSeverity } from "@/components/BroadcastBanner";
import {
  MAX_BODY_CHARS,
  htmlToText,
  sanitizeHtml,
} from "@/lib/league-office/sanitize-html";
import { toast } from "./actions";

const SEVERITY_OPTIONS: { value: BroadcastSeverity; label: string; hint: string }[] = [
  { value: "info", label: "Info", hint: "Neutral — schedule notes, feature news." },
  { value: "warning", label: "Warning", hint: "Attention — outages, deadlines." },
  { value: "celebration", label: "Celebration", hint: "Season opens, records, winners." },
];

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--color-warm-panel)",
  border: "1px solid var(--color-cream-border)",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 13,
  color: "#141210",
  outline: "none",
};

const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "#8d8375",
  display: "block",
  marginBottom: 5,
};

export default function BroadcastComposer({ recipientCount }: { recipientCount: number }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [rawHtml, setRawHtml] = useState("");
  const [severity, setSeverity] = useState<BroadcastSeverity>("info");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const previewHtml = sanitizeHtml(rawHtml);
  const previewText = htmlToText(previewHtml);
  const overLimit = rawHtml.length > MAX_BODY_CHARS;
  const canSend = previewText.length > 0 && !overLimit;

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming, busy]);

  function sync() {
    setRawHtml(editorRef.current?.innerHTML ?? "");
  }

  function exec(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    sync();
  }

  function addLink() {
    const url = window.prompt("Link URL (https:// or mailto: only)");
    if (!url) return;
    if (!/^(https:\/\/|mailto:)/i.test(url.trim())) {
      setErr("Links must start with https:// or mailto: — that one was not added.");
      return;
    }
    setErr(null);
    exec("createLink", url.trim());
  }

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/league-office/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "broadcast.send",
          reason: reason.trim(),
          bodyHtml: rawHtml,
          ctaLabel: ctaLabel.trim(),
          ctaUrl: ctaUrl.trim(),
          severity,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : "",
        }),
      });
      const j = await r.json().catch(() => ({ ok: false, message: "Request failed." }));
      if (!r.ok || !j.ok) {
        setErr(j.message || "Send failed.");
        setBusy(false);
        return;
      }
      // Clear the composer so a stray second click can't re-send the same copy.
      if (editorRef.current) editorRef.current.innerHTML = "";
      setRawHtml("");
      setCtaLabel("");
      setCtaUrl("");
      setExpiresAt("");
      setSeverity("info");
      setReason("");
      setConfirming(false);
      setBusy(false);
      toast(j.message || "Broadcast sent — logged to Audit Log.");
      router.refresh();
    } catch {
      setErr("Network error — nothing was sent.");
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <span style={label}>Message</span>
        <div
          style={{
            border: "1px solid var(--color-cream-border)",
            borderRadius: 8,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 4,
              padding: "6px 8px",
              borderBottom: "1px solid var(--color-cream-line)",
              background: "var(--color-warm-panel)",
              flexWrap: "wrap",
            }}
          >
            <ToolButton onClick={() => exec("bold")} title="Bold"><b>B</b></ToolButton>
            <ToolButton onClick={() => exec("italic")} title="Italic"><i>I</i></ToolButton>
            <ToolButton onClick={() => exec("underline")} title="Underline"><u>U</u></ToolButton>
            <ToolButton onClick={addLink} title="Add link">Link</ToolButton>
            <ToolButton onClick={() => exec("insertUnorderedList")} title="Bulleted list">• List</ToolButton>
            <ToolButton onClick={() => exec("insertOrderedList")} title="Numbered list">1. List</ToolButton>
            <ToolButton onClick={() => exec("removeFormat")} title="Clear formatting">Clear</ToolButton>
          </div>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Announcement message"
            onInput={sync}
            onBlur={sync}
            style={{
              minHeight: 120,
              padding: "12px 13px",
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "#141210",
              outline: "none",
            }}
          />
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: 10.5,
            color: overLimit ? "var(--color-brick)" : "#8d8375",
            marginTop: 5,
            display: "flex",
            gap: 10,
          }}
        >
          <span>
            {rawHtml.length.toLocaleString()} / {MAX_BODY_CHARS.toLocaleString()} characters
          </span>
          <span style={{ marginLeft: "auto" }}>
            Allowed: bold · italic · underline · lists · https/mailto links
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <span style={label}>Call-to-action label (optional)</span>
          <input
            value={ctaLabel}
            onChange={(e) => setCtaLabel(e.target.value)}
            placeholder="Play today's challenge"
            style={field}
          />
        </div>
        <div>
          <span style={label}>Call-to-action URL</span>
          <input
            value={ctaUrl}
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="https://faradaydailychallenge.com/challenge"
            style={field}
          />
        </div>
        <div>
          <span style={label}>Severity</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as BroadcastSeverity)}
            style={field}
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 11.5, color: "#8d8375", margin: "5px 0 0" }}>
            {SEVERITY_OPTIONS.find((o) => o.value === severity)?.hint}
          </p>
        </div>
        <div>
          <span style={label}>Expires (optional)</span>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={field}
          />
          <p style={{ fontSize: 11.5, color: "#8d8375", margin: "5px 0 0" }}>
            Leave empty to run until revoked.
          </p>
        </div>
      </div>

      <div>
        <span style={label}>Live preview — exactly what players see</span>
        <div style={{ background: "#0D110E", borderRadius: 8, overflow: "hidden" }}>
          {previewText ? (
            <BroadcastBannerView
              broadcast={{
                id: "preview",
                bodyHtml: previewHtml,
                bodyText: previewText,
                ctaLabel: ctaLabel.trim() || null,
                ctaUrl: ctaUrl.trim() || null,
                severity,
              }}
            />
          ) : (
            <div style={{ padding: "18px 20px", color: "#8CA68A", fontSize: 12.5 }}>
              Nothing to preview yet — type a message above.
            </div>
          )}
        </div>
      </div>

      {err && !confirming && (
        <p style={{ color: "var(--color-brick)", fontSize: 12.5, margin: 0 }}>{err}</p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="font-mono" style={{ fontSize: 11, color: "#8d8375" }}>
          AUDIENCE: {recipientCount.toLocaleString()} ACTIVE PLAYER
          {recipientCount === 1 ? "" : "S"}
        </span>
        <button
          onClick={() => {
            setErr(null);
            setConfirming(true);
          }}
          disabled={!canSend}
          style={{
            marginLeft: "auto",
            border: "none",
            borderRadius: 7,
            padding: "9px 18px",
            fontWeight: 700,
            fontSize: 13,
            color: "#fff",
            cursor: canSend ? "pointer" : "not-allowed",
            background: canSend ? "var(--color-forest)" : "var(--color-cream-edge)",
          }}
        >
          Send Broadcast
        </button>
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,18,16,.42)",
            display: "grid",
            placeItems: "center",
            zIndex: 40,
            padding: 20,
          }}
          onClick={(e) => e.target === e.currentTarget && !busy && setConfirming(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "24px 24px 20px",
              width: 460,
              maxWidth: "100%",
              border: "1px solid var(--color-cream-border)",
            }}
          >
            <h2 className="font-serif" style={{ fontSize: 19, margin: 0 }}>
              Send this broadcast?
            </h2>
            <div className="double-rule" style={{ margin: "10px 0 0" }} />
            <p style={{ fontSize: 13.5, color: "#6b6257", margin: "14px 0 16px" }}>
              This banner goes to all <strong>{recipientCount.toLocaleString()}</strong> active
              player{recipientCount === 1 ? "" : "s"} the next time they load the Daily Challenge.
              It shows until each player dismisses it{expiresAt ? ", it expires," : ""} or you
              revoke it.
            </p>
            <p
              style={{
                fontSize: 12.5,
                color: "#41382d",
                background: "var(--color-warm-panel)",
                border: "1px solid var(--color-cream-line)",
                borderRadius: 8,
                padding: "10px 12px",
                margin: "0 0 16px",
                fontStyle: "italic",
              }}
            >
              “{previewText.length > 180 ? `${previewText.slice(0, 180)}…` : previewText}”
            </p>

            <label className="font-mono" style={label}>
              Reason (required)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why are you sending this? This is written to the Audit Log."
              style={{ ...field, resize: "vertical", fontFamily: "inherit" }}
              autoFocus
            />

            {err && (
              <p style={{ color: "var(--color-brick)", fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => !busy && setConfirming(false)}
                style={{
                  fontSize: 12.5,
                  padding: "7px 12px",
                  borderRadius: 7,
                  border: "1px solid var(--color-cream-border)",
                  cursor: "pointer",
                  background: "#fff",
                  color: "#6b6257",
                }}
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={busy || reason.trim().length === 0}
                style={{
                  border: "none",
                  borderRadius: 7,
                  padding: "9px 18px",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#fff",
                  cursor: busy || !reason.trim() ? "not-allowed" : "pointer",
                  background: busy || !reason.trim() ? "var(--color-cream-edge)" : "var(--color-forest)",
                }}
              >
                {busy ? "Sending…" : "Send Broadcast"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      style={{
        fontSize: 12,
        minWidth: 28,
        padding: "4px 8px",
        borderRadius: 6,
        border: "1px solid var(--color-cream-border)",
        background: "#fff",
        color: "#41382d",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
