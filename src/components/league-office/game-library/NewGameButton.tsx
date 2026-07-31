"use client";

// League Office — create a new game. Always lands as `new_idea` (Phase 4): a
// concept has no puzzle bank and no runtime key, so it can be neither live nor
// assignable. The lifecycle form in the drawer is the only way forward from
// there, and the D9 trigger backs that up in the database.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/league-office/actions";
import { toGameKey } from "@/lib/league-office/game-library-logic";

const CATEGORIES = ["word", "logic", "data", "spatial", "editorial"];

export function NewGameButton() {
  const [open, setOpen] = useState(false);
  const [displayName, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const key = toGameKey(displayName);
  const canSubmit = !!key && !!reason.trim() && !busy;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/league-office/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "game.create", displayName, category, description, reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.message ?? "That game could not be created.");
        return;
      }
      toast(json.message ?? "Game created — logged to Audit Log.");
      setOpen(false);
      setName("");
      setCategory("");
      setDescription("");
      setReason("");
      router.refresh();
    } catch {
      setErr("Network error — nothing was created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12.5,
          padding: "8px 14px",
          borderRadius: 7,
          border: "1px solid var(--color-forest)",
          background: "var(--color-forest)",
          color: "#f8f5f0",
          cursor: "pointer",
          whiteSpace: "nowrap",
          font: "inherit",
        }}
      >
        New game
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New game"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(20,18,16,.32)",
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fdfcfa",
              border: "1px solid var(--color-cream-border)",
              borderRadius: 12,
              padding: 22,
              width: "min(440px, 100%)",
            }}
          >
            <h2 className="font-serif text-near-black" style={{ fontSize: 19, margin: "0 0 4px" }}>
              New game
            </h2>
            <p style={{ fontSize: 12, color: "#6b6257", margin: "0 0 14px" }}>
              Lands as a <strong>new idea</strong> — inactive, no runtime key, not assignable to a
              season until it reaches test.
            </p>

            <Field label="Display name" value={displayName} onChange={setName} />
            {key ? (
              <p className="font-mono" style={{ fontSize: 10.5, color: "#9c9488", margin: "-4px 0 10px" }}>
                game_key: {key}
              </p>
            ) : null}

            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={LABEL}>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={FIELD}>
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <Field label="Description" value={description} onChange={setDescription} />
            <Field label="Reason (required)" value={reason} onChange={setReason} />

            {err ? <p style={{ color: "#9c3b2e", fontSize: 12, margin: "0 0 8px" }}>{err}</p> : null}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
              <button type="button" onClick={() => setOpen(false)} style={GHOST}>
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  ...GHOST,
                  border: "1px solid var(--color-forest)",
                  background: canSubmit ? "var(--color-forest)" : "var(--color-warm-panel)",
                  color: canSubmit ? "#f8f5f0" : "#9c9488",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {busy ? "Creating…" : "Create game"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const LABEL: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "#8d8375",
  marginBottom: 4,
};

const FIELD: React.CSSProperties = {
  width: "100%",
  fontSize: 12.5,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--color-cream-border)",
  background: "#fff",
  color: "#141210",
  font: "inherit",
};

const GHOST: React.CSSProperties = {
  fontSize: 12.5,
  padding: "7px 13px",
  borderRadius: 7,
  border: "1px solid var(--color-cream-border)",
  background: "#fff",
  color: "#6b6257",
  cursor: "pointer",
  font: "inherit",
};

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={LABEL}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={FIELD} />
    </label>
  );
}
