"use client";

// League Office — Playoff & roster-freeze date editor (Section-style card on the
// season detail page).
//
// These two dates live on `seasons` and are REQUIRED by the generation checklist
// (condition 2) before a season can generate puzzles — but nothing in the app
// wrote them until now, so a commissioner had no way to satisfy the checklist.
// This card is the missing editor. It PATCHes /api/lo/seasons/[id] (patch =
// { playoff_starts_on, roster_freeze_on }), which validates the ordering rules
// server-side (inside the window · freeze ≤ playoff · freeze ≥ a quarter in) and
// writes one audited row. A locked season is read-only here, same as every other
// detail edit.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import { MiniButton, Callout, INK, MUTED, FAINT } from "./fields";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  border: "1px solid var(--color-cream-border)",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
  color: INK,
  fontFamily: "inherit",
};

export function SeasonDatesCard({
  seasonId,
  locked,
  startsOn,
  endsOn,
  playoffStartsOn,
  rosterFreezeOn,
}: {
  seasonId: string;
  locked: boolean;
  startsOn: string | null;
  endsOn: string | null;
  playoffStartsOn: string | null;
  rosterFreezeOn: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playoff, setPlayoff] = useState(playoffStartsOn ?? "");
  const [freeze, setFreeze] = useState(rosterFreezeOn ?? "");

  const beginEdit = () => {
    setPlayoff(playoffStartsOn ?? "");
    setFreeze(rosterFreezeOn ?? "");
    setOpen(true);
  };

  const save = async (reason: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lo/seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: { playoff_starts_on: playoff || "", roster_freeze_on: freeze || "" },
          reason,
        }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Dates updated." : "That did not work."));
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: string | null) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
      <span
        className="font-mono"
        style={{ fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: FAINT, width: 120, flex: "none" }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: value ? INK : "#b0a89b" }}>{value ?? "Not set"}</span>
    </div>
  );

  return (
    <div>
      {locked ? (
        <Callout tone="locked">This season is locked — the playoff and roster-freeze dates can still be edited; everything else is frozen until you unlock it.</Callout>
      ) : null}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 220 }}>
          {row("Playoff starts", playoffStartsOn)}
          {row("Roster freeze", rosterFreezeOn)}
        </div>
        <MiniButton tone="gold" onClick={beginEdit} disabled={busy}>
          Edit dates
        </MiniButton>
      </div>

      <p style={{ fontSize: 12, color: MUTED, margin: "12px 0 0", lineHeight: 1.5 }}>
        Both are required before this season can generate puzzles. Playoff start must fall inside the
        season window; roster freeze must be on or before the playoff start and at least a quarter of
        the way into the season.
      </p>

      <ReasonDialog
        open={open}
        busy={busy}
        title="Set playoff & roster-freeze dates"
        description={
          <>
            Season window: <strong>{startsOn ?? "?"}</strong> → <strong>{endsOn ?? "?"}</strong>. Leave a
            field blank to clear it.
          </>
        }
        details={
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "block" }}>
              <span
                className="font-mono"
                style={{ display: "block", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 5 }}
              >
                Playoff starts on
              </span>
              <input
                type="date"
                value={playoff}
                disabled={busy}
                min={startsOn ?? undefined}
                max={endsOn ?? undefined}
                onChange={(e) => setPlayoff(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block" }}>
              <span
                className="font-mono"
                style={{ display: "block", fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 5 }}
              >
                Roster freeze on
              </span>
              <input
                type="date"
                value={freeze}
                disabled={busy}
                min={startsOn ?? undefined}
                max={playoff || endsOn || undefined}
                onChange={(e) => setFreeze(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
        }
        confirmLabel="Save dates"
        onCancel={() => setOpen(false)}
        onConfirm={save}
      />
    </div>
  );
}
