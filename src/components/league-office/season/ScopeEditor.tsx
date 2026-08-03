"use client";

// CC-LO-SEASON-SCOPE-1.0 — the ONE scope editor. The create wizard's step 3 and
// the config editor's Section B both render this; a divergence between them is
// what let the wizard write a scope the editor then silently replaced.
//
// Two structural rules, both of which exist because of a real incident:
//
//  1. INCLUDES offer leagues and conferences only, and every option's value is a
//     live id read from `leagues` / `conferences` in this request. The dangling
//     `6346a188-…` was a top-level `teams` row that the pre-Part-B picker listed
//     as a "league"; when Part B deleted the row the scope pointed at nothing.
//     There is no code path here that can emit an id from anywhere else.
//
//  2. EXCLUSIONS carry their own type. They used to be bare ids typed by
//     whatever the include mode happened to be, which is how three TEAM ids were
//     written as `league` rows. The type now travels with the id.
//
// The preview is server-resolved by fn_season_scope_preview — the same SQL the
// leaderboard filter uses. A preview computed in TypeScript would be a second
// implementation of D1/D3/D4/D6 and would eventually disagree with the engine.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScopeOptions, ScopeResolution } from "@/lib/league-office/seasons";
import type { ScopeExclusion, WizardScope } from "@/lib/league-office/season-config-logic";

const GOLD = "var(--color-gold, #c4922a)";
const INK = "var(--color-ink, #1a1a1a)";
const MUTED = "var(--color-muted, #5a5a5a)";
const FAINT = "var(--color-faint, #8a8a8a)";

export type ScopeState = {
  mode: WizardScope["mode"];
  refIds: string[];
  excludes: ScopeExclusion[];
};

export const emptyScope = (): ScopeState => ({ mode: "platform", refIds: [], excludes: [] });

export const toWizardScope = (s: ScopeState): WizardScope => ({
  mode: s.mode,
  refIds: s.refIds,
  excludes: s.excludes,
});

export function ScopeEditor({
  value,
  onChange,
  options,
  seasonId,
  disabled,
  /** Rendered under the preview — the wizard uses it to say the season does not
   *  exist yet, so conference membership cannot be resolved per-season. */
  note,
}: {
  value: ScopeState;
  onChange: (next: ScopeState) => void;
  options: ScopeOptions;
  /** null in the create wizard: there is no season row to resolve against yet. */
  seasonId: string | null;
  disabled?: boolean;
  note?: string;
}) {
  const [preview, setPreview] = useState<ScopeResolution | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [showTeams, setShowTeams] = useState(false);
  const seq = useRef(0);

  const set = (patch: Partial<ScopeState>) => onChange({ ...value, ...patch });

  const toggleRef = (id: string) =>
    set({ refIds: value.refIds.includes(id) ? value.refIds.filter((x) => x !== id) : [...value.refIds, id] });

  const toggleExclude = (type: ScopeExclusion["type"], id: string) => {
    const on = value.excludes.some((x) => x.type === type && x.id === id);
    set({
      excludes: on
        ? value.excludes.filter((x) => !(x.type === type && x.id === id))
        : [...value.excludes, { type, id }],
    });
  };

  // Server-resolved preview. `seq` guards against an older in-flight request
  // landing after a newer one and showing a stale team list.
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    setPreviewing(true);
    try {
      const res = await fetch("/api/lo/scopes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonId, scope: toWizardScope(value) }),
      });
      const j = await res.json().catch(() => ({}));
      if (mine === seq.current) setPreview(res.ok ? (j.summary ?? null) : null);
    } catch {
      if (mine === seq.current) setPreview(null);
    } finally {
      if (mine === seq.current) setPreviewing(false);
    }
  }, [seasonId, value]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const modeChosen = value.mode !== "platform";
  const needsRefs = modeChosen && value.refIds.length === 0;

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        <Radio
          name="scope-mode" checked={value.mode === "platform"} disabled={disabled}
          label="Whole platform (all leagues)"
          onChange={() => set({ mode: "platform", refIds: [] })}
        />
        <Radio
          name="scope-mode" checked={value.mode === "leagues"} disabled={disabled}
          label="Specific leagues"
          onChange={() => set({ mode: "leagues", refIds: [] })}
        />
        <Radio
          name="scope-mode" checked={value.mode === "conferences"} disabled={disabled || !options.conferences.length}
          label={options.conferences.length ? "Specific conferences" : "Specific conferences (none defined yet)"}
          onChange={() => set({ mode: "conferences", refIds: [] })}
        />
      </div>

      {modeChosen ? (
        <Chips
          label={value.mode === "leagues" ? "Included leagues" : "Included conferences"}
          options={value.mode === "leagues" ? options.leagues : options.conferences}
          isOn={(id) => value.refIds.includes(id)}
          onToggle={toggleRef}
          disabled={disabled}
        />
      ) : null}

      {needsRefs ? (
        <div style={{ fontSize: 12, color: "#9a3412", marginTop: 8 }}>
          Choose at least one {value.mode === "leagues" ? "league" : "conference"}, or switch to
          whole platform.
        </div>
      ) : null}

      {/* Exclusions. Disabled until an include mode is chosen — an exclusion
          without an inclusion has nothing to subtract from. "Whole platform"
          counts as chosen: "everyone except X" is the common case. */}
      <div style={{ marginTop: 18, opacity: needsRefs ? 0.45 : 1 }}>
        <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 4 }}>
          Excluded (optional)
        </div>
        <div style={{ fontSize: 11.5, color: FAINT, marginBottom: 10 }}>
          An exclusion always wins — a team excluded directly, or through its conference or league,
          is out even if it is also included.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Chips
            label="Leagues" options={options.leagues}
            isOn={(id) => value.excludes.some((x) => x.type === "league" && x.id === id)}
            onToggle={(id) => toggleExclude("league", id)}
            disabled={disabled || needsRefs}
          />
          <Chips
            label="Conferences" options={options.conferences}
            isOn={(id) => value.excludes.some((x) => x.type === "conference" && x.id === id)}
            onToggle={(id) => toggleExclude("conference", id)}
            disabled={disabled || needsRefs}
          />
          <Chips
            label="Teams" options={options.teams}
            isOn={(id) => value.excludes.some((x) => x.type === "team" && x.id === id)}
            onToggle={(id) => toggleExclude("team", id)}
            disabled={disabled || needsRefs}
          />
        </div>
      </div>

      {/* ── live preview ─────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 18, padding: "12px 14px", borderRadius: 6,
          border: "1px solid var(--color-cream-border)", background: "rgba(196,146,42,.05)",
        }}
      >
        {preview ? (
          <>
            <div style={{ fontSize: 13, color: INK }}>
              This season covers <strong>{preview.team_count}</strong>{" "}
              team{preview.team_count === 1 ? "" : "s"} across{" "}
              <strong>{preview.league_count}</strong> league{preview.league_count === 1 ? "" : "s"}
              {preview.conference_count ? (
                <> / <strong>{preview.conference_count}</strong> conference{preview.conference_count === 1 ? "" : "s"}</>
              ) : null}
              .
              {preview.excluded.length ? (
                <>
                  {" "}
                  {preview.excluded.length} exclusion{preview.excluded.length === 1 ? "" : "s"}:{" "}
                  {preview.excluded.map((e) => e.name ?? "unknown").join(", ")}.
                </>
              ) : null}
            </div>

            {preview.team_count === 0 ? (
              <div style={{ fontSize: 12, color: "#9a3412", marginTop: 8 }}>
                No teams resolve from this scope. Saving it would leave the season with nobody in it.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTeams((v) => !v)}
                style={{ marginTop: 8, fontSize: 11.5, color: MUTED, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
              >
                {showTeams ? "Hide" : "Show"} the {preview.team_count} resolved team
                {preview.team_count === 1 ? "" : "s"}
              </button>
            )}

            {showTeams ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: MUTED, columns: 2 }}>
                {preview.teams.map((t) => <li key={t.id}>{t.name}</li>)}
              </ul>
            ) : null}
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: FAINT }}>
            {previewing ? "Resolving…" : "Could not resolve this scope — check the picks above."}
          </div>
        )}

        {note ? (
          <div style={{ fontSize: 11, color: FAINT, marginTop: 10 }}>{note}</div>
        ) : null}
      </div>
    </div>
  );
}

// ── local widgets ────────────────────────────────────────────────────────────

function Radio({
  name, checked, onChange, label, disabled,
}: {
  name: string; checked: boolean; onChange: () => void; label: string; disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: disabled ? FAINT : INK, cursor: disabled ? "not-allowed" : "pointer" }}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} style={{ accentColor: GOLD }} />
      {label}
    </label>
  );
}

function Chips({
  label, options, isOn, onToggle, disabled,
}: {
  label: string;
  options: { id: string; name: string }[];
  isOn: (id: string) => boolean;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 6 }}>
        {label}
      </div>
      {options.length === 0 ? (
        <div style={{ fontSize: 12, color: FAINT }}>Nothing available.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {options.map((o) => {
            const on = isOn(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => onToggle(o.id)}
                aria-pressed={on}
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: `1px solid ${on ? GOLD : "var(--color-cream-border)"}`,
                  background: on ? "rgba(196,146,42,.14)" : "#fff",
                  color: on ? "#94560a" : MUTED,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
