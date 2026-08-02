"use client";

// League Office — the Season Config editor (spec §2.4).
//
// Left nav of sections · right pane content · sticky footer with the unsaved
// indicator, the live validation summary, and Save / Schedule / Promote.
//
// THE editing rule, enforced here AND at the API layer: only `draft` and
// `scheduled` versions are writable. An `active` version is read-only and the
// single affordance is "Clone to new version" — that is what keeps the version
// history honest.
//
// The game slate is rendered from `game_catalog`, never from a hardcoded list:
// a new catalog row shows up as a new slate row with no code change.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/league-office/actions";
import { StatusChip } from "@/components/league-office/primitives";
import { ReasonDialog } from "./ReasonDialog";
import {
  Callout, DayMask, FAINT, Field, GOLD, Grid, INK, MiniButton, MUTED, NumberInput,
  PercentControl, PrimaryButton, Section, Select, Sparkline, Stepper, TextArea,
  TextInput, Toggle, TotalBar,
} from "./fields";
import type {
  ConfigBundle, GameCatalogRow, ScopeOptions, SeasonConfigRow, ThemeTheater,
} from "@/lib/league-office/seasons";
import {
  curvePoints, DIFFICULTY_BANDS, DIFFICULTY_CURVES, diffConfigs, editability,
  evenSplit, fieldLabel, formatValue, isHundred, LEADERBOARD_VISIBILITIES,
  localFindings, normalizeTo100, promoteIntent, round2, summarizeFindings,
  sumPct, TEAM_SCORE_METHODS,
} from "@/lib/league-office/season-config-logic";

// ── local row shapes (client-side working copies) ────────────────────────────

type GameRow = {
  game_id: string;
  is_enabled: boolean;
  weight: number;
  points_override: number | null;
  difficulty_floor: string | null;
  difficulty_ceiling: string | null;
  appears_on_days: number[] | null;
  starts_on: string | null;
  ends_on: string | null;
  sort_order: number;
  notes: string | null;
};

type ThemeRow = {
  theater_id: string;
  sector_code: string | null;
  thread_code: string | null;
  target_pct: number;
  min_pct: number | null;
  max_pct: number | null;
  is_excluded: boolean;
};

type DiffRow = {
  difficulty_band: string;
  target_pct: number;
  min_pct: number | null;
  max_pct: number | null;
  applies_to_game_id: string | null;
};

type ScopeMode = "platform" | "leagues" | "conferences";

const SECTIONS = [
  { id: "sec-a", label: "Effective dating" },
  { id: "sec-b", label: "Scope & assignment" },
  { id: "sec-c", label: "Game slate" },
  { id: "sec-d", label: "Theme & domain mix" },
  { id: "sec-e", label: "Difficulty" },
  { id: "sec-f", label: "Teams & participation" },
  { id: "sec-g", label: "Scoring" },
  { id: "sec-h", label: "Visibility" },
  { id: "sec-i", label: "Advanced" },
];

export default function ConfigEditor({
  bundle,
  scopeOptions,
  taxonomy,
  incumbent,
  scopeTeamCount,
}: {
  bundle: ConfigBundle;
  scopeOptions: ScopeOptions;
  taxonomy: ThemeTheater[];
  incumbent: SeasonConfigRow | null;
  scopeTeamCount: number;
}) {
  const router = useRouter();
  const seasonLocked = !!bundle.season?.locked_at;
  const edit = editability(bundle.config.state);
  const readOnly = !edit.editable || seasonLocked;

  // ── working state ──────────────────────────────────────────────────────────
  const [config, setConfig] = useState<Record<string, unknown>>(() => ({ ...bundle.config }));
  const [games, setGames] = useState<GameRow[]>(() => mergeSlate(bundle.catalog, bundle.games));
  const [themeMix, setThemeMix] = useState<ThemeRow[]>(() =>
    bundle.themeMix.map((t) => ({
      theater_id: t.theater_id, sector_code: t.sector_code, thread_code: t.thread_code,
      target_pct: Number(t.target_pct), min_pct: t.min_pct, max_pct: t.max_pct, is_excluded: t.is_excluded,
    }))
  );
  const [difficultyMix, setDifficultyMix] = useState<DiffRow[]>(() =>
    bundle.difficultyMix.map((d) => ({
      difficulty_band: d.difficulty_band, target_pct: Number(d.target_pct),
      min_pct: d.min_pct, max_pct: d.max_pct, applies_to_game_id: d.applies_to_game_id,
    }))
  );
  const [scopeMode, setScopeMode] = useState<ScopeMode>(() => initialScopeMode(bundle));
  const [scopeRefs, setScopeRefs] = useState<string[]>(() =>
    bundle.scopes.filter((s) => !s.is_excluded && s.scope_ref_id).map((s) => s.scope_ref_id as string)
  );
  const [scopeExcludes, setScopeExcludes] = useState<string[]>(() =>
    bundle.scopes.filter((s) => s.is_excluded && s.scope_ref_id).map((s) => s.scope_ref_id as string)
  );

  const [fingerprint, setFingerprint] = useState(bundle.fingerprint);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | "save" | "promote" | "cancel">(null);
  const [pendingCapAck, setPendingCapAck] = useState(false);

  const touch = useCallback(() => setDirty(true), []);
  const setCfg = useCallback(
    (key: string, value: unknown) => {
      setConfig((c) => ({ ...c, [key]: value }));
      touch();
    },
    [touch]
  );

  // ── derived ────────────────────────────────────────────────────────────────
  const catalogById = useMemo(
    () => new Map(bundle.catalog.map((c) => [c.id, c])),
    [bundle.catalog]
  );

  const enabledCount = games.filter((g) => g.is_enabled).length;
  const totalWeight = round2(games.filter((g) => g.is_enabled).reduce((a, g) => a + (Number(g.weight) || 0), 0));

  const themeTotal = sumPct(themeMix.filter((t) => !t.is_excluded).map((t) => t.target_pct));
  const baseDifficulty = difficultyMix.filter((d) => !d.applies_to_game_id);
  const difficultyTotal = sumPct(baseDifficulty.map((d) => d.target_pct));

  const findings = useMemo(
    () =>
      localFindings({
        games: games.map((g) => ({ is_enabled: g.is_enabled })),
        themeMix,
        difficultyMix,
        gamesPerDay: config.games_per_day == null ? null : Number(config.games_per_day),
        teamScoreMethod: String(config.team_score_method ?? "sum"),
        teamScoreTopN: config.team_score_top_n == null ? null : Number(config.team_score_top_n),
      }),
    [games, themeMix, difficultyMix, config]
  );
  const errorCount = findings.filter((f) => f.severity === "error").length;

  const intent = promoteIntent(String(config.effective_from ?? ""));

  // ── save ───────────────────────────────────────────────────────────────────
  const save = async (reason: string, acknowledgeCapWarning = false) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lo/configs/${bundle.config.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config, games, themeMix, difficultyMix,
          scope: { mode: scopeMode, refIds: scopeRefs, excludeIds: scopeExcludes },
          fingerprint, reason, acknowledgeCapWarning,
        }),
      });
      const j = await res.json().catch(() => ({}));

      if (!res.ok) {
        // A cap reduction needs an explicit acknowledgement — re-open the dialog
        // with the count so the commissioner decides. Memberships are never
        // auto-removed.
        if (j?.capWarning) {
          setPendingCapAck(true);
          toast(j.message);
          setDialog("save");
          return;
        }
        if (j?.conflict) toast(j.message);
        else toast(j?.message ?? "Save failed.");
        return;
      }

      if (j.fingerprint) setFingerprint(j.fingerprint);
      setDirty(false);
      setPendingCapAck(false);
      setDialog(null);
      toast(j.message ?? "Draft saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const promote = async (reason: string) => {
    setBusy(true);
    try {
      // Save any pending edits first so what is promoted is what is on screen.
      if (dirty) {
        const res = await fetch(`/api/lo/configs/${bundle.config.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config, games, themeMix, difficultyMix,
            scope: { mode: scopeMode, refIds: scopeRefs, excludeIds: scopeExcludes },
            fingerprint, reason, acknowledgeCapWarning: true,
          }),
        });
        const sj = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(sj?.message ?? "Save failed — nothing was promoted.");
          return;
        }
        if (sj.fingerprint) setFingerprint(sj.fingerprint);
        setDirty(false);
      }

      const res = await fetch(`/api/lo/configs/${bundle.config.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Promoted." : "Promote failed."));
      if (res.ok) {
        setDialog(null);
        router.push(`/league-office/seasons/${bundle.config.season_id}`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelVersion = async (reason: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lo/configs/${bundle.config.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Cancelled." : "Cancel failed."));
      if (res.ok) {
        setDialog(null);
        router.push(`/league-office/seasons/${bundle.config.season_id}`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const clone = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lo/seasons/${bundle.config.season_id}/configs/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: `Cloned from v${bundle.config.version} to edit a live season.` }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "New draft created." : "Clone failed."));
      if (res.ok && j.configId)
        router.push(`/league-office/seasons/${bundle.config.season_id}/config/${j.configId}`);
    } finally {
      setBusy(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ paddingBottom: 90 }}>
      <Link
        href={`/league-office/seasons/${bundle.config.season_id}`}
        style={{ fontSize: 12.5, color: "var(--color-amber-dark)", textDecoration: "none" }}
      >
        ← {bundle.season?.name ?? "Season"}
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0 6px", flexWrap: "wrap" }}>
        <h1 className="font-serif" style={{ fontSize: 25, margin: 0, color: INK }}>
          v{bundle.config.version}
          {bundle.config.label ? ` · ${bundle.config.label}` : ""}
        </h1>
        <StatusChip label={bundle.config.state} />
        {seasonLocked ? <StatusChip label="season locked" tone="red" /> : null}
      </div>
      <div className="double-rule" />

      {readOnly ? (
        <div style={{ marginTop: 14 }}>
          <Callout tone={seasonLocked ? "danger" : "locked"}>
            <strong>Read-only.</strong>{" "}
            {seasonLocked
              ? "This season is locked — unlock it from the season page before changing any configuration."
              : edit.reason}
            {!seasonLocked && bundle.config.state === "active" ? (
              <div style={{ marginTop: 10 }}>
                <MiniButton tone="gold" onClick={clone} disabled={busy}>
                  Clone to new version
                </MiniButton>
              </div>
            ) : null}
          </Callout>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 18, marginTop: 16 }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          {/* left nav */}
          <nav
            style={{
              width: 186,
              flex: "none",
              position: "sticky",
              top: 16,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="font-mono"
                style={{
                  fontSize: 10,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: MUTED,
                  textDecoration: "none",
                  padding: "7px 10px",
                  borderRadius: 6,
                  borderLeft: "2px solid transparent",
                }}
              >
                {s.label}
              </a>
            ))}
          </nav>

          {/* right pane */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* ── A. Effective dating ─────────────────────────────────────── */}
            <Section id="sec-a" title="Effective dating">
              <Callout tone="info">
                Changes take effect at the date below. Until then the current active version stays in
                force.{" "}
                {intent.action === "schedule"
                  ? "This date is in the future, so promoting will SCHEDULE this version — it flips to active automatically when the date arrives."
                  : "This date has passed, so promoting makes this version live immediately."}
              </Callout>
              <Grid>
                <Field
                  label="Effective from"
                  hint={bundle.season?.tz ? `Season timezone: ${bundle.season.tz}` : undefined}
                >
                  <TextInput
                    type="datetime-local"
                    disabled={readOnly}
                    value={toLocalInput(config.effective_from)}
                    onChange={(v) => setCfg("effective_from", v ? new Date(v).toISOString() : null)}
                  />
                </Field>
                <Field label="Effective to" hint="Usually left empty — the next version supersedes this one.">
                  <TextInput
                    type="datetime-local"
                    disabled={readOnly}
                    value={toLocalInput(config.effective_to)}
                    onChange={(v) => setCfg("effective_to", v ? new Date(v).toISOString() : null)}
                  />
                </Field>
                <Field label="Label">
                  <TextInput
                    disabled={readOnly}
                    value={String(config.label ?? "")}
                    placeholder="e.g. Spring rules revision"
                    onChange={(v) => setCfg("label", v)}
                  />
                </Field>
              </Grid>
              <div style={{ marginTop: 14 }}>
                <Field label="Notes">
                  <TextArea
                    disabled={readOnly}
                    value={String(config.notes ?? "")}
                    onChange={(v) => setCfg("notes", v)}
                    placeholder="What changed and why — visible in the version history."
                  />
                </Field>
              </div>
            </Section>

            {/* ── B. Scope & assignment ───────────────────────────────────── */}
            <Section
              id="sec-b"
              title="Scope & assignment"
              blurb="Which leagues or conferences this season applies to. Scope is a property of the season, so saving here updates it for every version."
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                <Radio
                  name="scope-mode"
                  checked={scopeMode === "platform"}
                  disabled={readOnly}
                  label="All leagues (platform)"
                  onChange={() => { setScopeMode("platform"); touch(); }}
                />
                <Radio
                  name="scope-mode"
                  checked={scopeMode === "leagues"}
                  disabled={readOnly}
                  label="Specific leagues"
                  onChange={() => { setScopeMode("leagues"); touch(); }}
                />
                <Radio
                  name="scope-mode"
                  checked={scopeMode === "conferences"}
                  disabled={readOnly || !scopeOptions.conferences.length}
                  label={
                    scopeOptions.conferences.length
                      ? "Specific conferences"
                      : "Specific conferences (none defined yet)"
                  }
                  onChange={() => { setScopeMode("conferences"); touch(); }}
                />
              </div>

              {scopeMode !== "platform" ? (
                <MultiSelect
                  label={scopeMode === "leagues" ? "Included leagues" : "Included conferences"}
                  disabled={readOnly}
                  options={scopeMode === "leagues" ? scopeOptions.leagues : scopeOptions.conferences}
                  selected={scopeRefs}
                  onToggle={(id) => { setScopeRefs(toggleIn(scopeRefs, id)); touch(); }}
                />
              ) : null}

              <div style={{ marginTop: 14 }}>
                <MultiSelect
                  label="Excluded (optional)"
                  disabled={readOnly}
                  options={scopeMode === "conferences" ? scopeOptions.conferences : scopeOptions.leagues}
                  selected={scopeExcludes}
                  onToggle={(id) => { setScopeExcludes(toggleIn(scopeExcludes, id)); touch(); }}
                />
              </div>

              <div className="font-mono" style={{ fontSize: 11, color: FAINT, marginTop: 12 }}>
                {scopeTeamCount} team{scopeTeamCount === 1 ? "" : "s"} resolved from the saved scope
                {dirty ? " (recalculated on save)" : ""}
              </div>
            </Section>

            {/* ── C. Game slate ───────────────────────────────────────────── */}
            <Section
              id="sec-c"
              title="Game slate"
              blurb="Driven by the game catalog — a new puzzle type added to the catalog appears here automatically."
            >
              <Grid cols={3}>
                <Field
                  label="Games per day"
                  hint={`Must not exceed the ${enabledCount} enabled game${enabledCount === 1 ? "" : "s"}.`}
                >
                  <NumberInput
                    disabled={readOnly}
                    min={0}
                    max={enabledCount}
                    value={config.games_per_day as number | null}
                    onChange={(v) => setCfg("games_per_day", v)}
                    placeholder="all"
                  />
                </Field>
                <Field label="Play days of week" hint="Master mask — a game may narrow it further, never widen it.">
                  <DayMask
                    disabled={readOnly}
                    value={(config.play_days_of_week as number[]) ?? null}
                    onChange={(v) => setCfg("play_days_of_week", v)}
                  />
                </Field>
              </Grid>

              <div style={{ marginTop: 16, overflowX: "auto" }}>
                <div style={{ minWidth: 1140 }}>
                  <SlateHeader />
                  {games.map((g, i) => (
                    <SlateRow
                      key={g.game_id}
                      row={g}
                      index={i}
                      game={catalogById.get(g.game_id)}
                      disabled={readOnly}
                      onChange={(next) => {
                        setGames((rows) => rows.map((r, ri) => (ri === i ? next : r)));
                        touch();
                      }}
                      onMove={(dir) => {
                        setGames((rows) => reorder(rows, i, i + dir));
                        touch();
                      }}
                      onDropRow={(from) => {
                        setGames((rows) => reorder(rows, from, i));
                        touch();
                      }}
                      isFirst={i === 0}
                      isLast={i === games.length - 1}
                    />
                  ))}
                </div>
              </div>

              <div className="font-mono" style={{ fontSize: 11, color: FAINT, marginTop: 12 }}>
                {enabledCount} game{enabledCount === 1 ? "" : "s"} enabled · total weight {totalWeight}
              </div>
            </Section>

            {/* ── D. Theme & domain mix ───────────────────────────────────── */}
            <Section
              id="sec-d"
              title="Theme & domain mix"
              blurb="Allocation across Theaters, optionally drilled into Sectors and Threads."
            >
              <TotalBar
                total={themeTotal}
                disabled={readOnly}
                onNormalize={() => { setThemeMix(normalizeThemeRows(themeMix)); touch(); }}
                onEven={() => { setThemeMix(evenThemeRows(themeMix, taxonomy)); touch(); }}
              />

              {taxonomy.length === 0 && themeMix.length === 0 ? (
                <Callout tone="warning">
                  No theme taxonomy is available to allocate against yet.
                </Callout>
              ) : null}

              {theaterList(taxonomy, themeMix).map((t) => {
                const row = themeMix.find(
                  (r) => r.theater_id === t.theater_id && !r.sector_code && !r.thread_code
                );
                const children = themeMix.filter((r) => r.theater_id === t.theater_id && r.sector_code);
                const isOpen = expanded.has(t.theater_id);

                return (
                  <div
                    key={t.theater_id}
                    style={{
                      borderTop: "1px solid var(--color-cream-line)",
                      padding: "10px 0",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(t.theater_id)) n.delete(t.theater_id);
                            else n.add(t.theater_id);
                            return n;
                          })
                        }
                        aria-expanded={isOpen}
                        aria-label={`Expand ${t.theater_name}`}
                        style={{
                          border: "none", background: "none", cursor: "pointer",
                          color: FAINT, fontSize: 11, width: 16, padding: 0,
                        }}
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                      <span className="font-mono" style={{ fontSize: 10.5, color: FAINT, width: 44 }}>
                        {t.theater_id}
                      </span>
                      <span style={{ fontSize: 13, color: INK, minWidth: 160, flex: 1 }}>
                        {t.theater_name}
                      </span>
                      <span style={{ width: 260, opacity: row?.is_excluded ? 0.4 : 1 }}>
                        <PercentControl
                          disabled={readOnly || row?.is_excluded}
                          value={row?.target_pct ?? 0}
                          onChange={(v) => {
                            setThemeMix(upsertTheater(themeMix, t.theater_id, { target_pct: v }));
                            touch();
                          }}
                        />
                      </span>
                      <MiniButton
                        disabled={readOnly}
                        tone={row?.is_excluded ? "danger" : "neutral"}
                        onClick={() => {
                          setThemeMix(
                            upsertTheater(themeMix, t.theater_id, { is_excluded: !row?.is_excluded })
                          );
                          touch();
                        }}
                      >
                        {row?.is_excluded ? "Excluded" : "Exclude"}
                      </MiniButton>
                    </div>

                    {isOpen ? (
                      <div style={{ paddingLeft: 70, marginTop: 8 }}>
                        <Grid cols={3}>
                          <Field label="Min %">
                            <NumberInput
                              disabled={readOnly}
                              value={row?.min_pct ?? null}
                              onChange={(v) => { setThemeMix(upsertTheater(themeMix, t.theater_id, { min_pct: v })); touch(); }}
                              suffix="%"
                            />
                          </Field>
                          <Field label="Max %">
                            <NumberInput
                              disabled={readOnly}
                              value={row?.max_pct ?? null}
                              onChange={(v) => { setThemeMix(upsertTheater(themeMix, t.theater_id, { max_pct: v })); touch(); }}
                              suffix="%"
                            />
                          </Field>
                        </Grid>

                        {t.sectors.length ? (
                          <div style={{ marginTop: 12 }}>
                            <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 6 }}>
                              Sectors within {t.theater_name}
                            </div>
                            {t.sectors.map((sec) => {
                              const srow = children.find((c) => c.sector_code === sec.code && !c.thread_code);
                              return (
                                <div key={sec.code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                                  <span style={{ fontSize: 12.5, color: MUTED, flex: 1, minWidth: 120 }}>{sec.name}</span>
                                  <span style={{ width: 240 }}>
                                    <PercentControl
                                      disabled={readOnly}
                                      value={srow?.target_pct ?? 0}
                                      onChange={(v) => {
                                        setThemeMix(upsertSector(themeMix, t.theater_id, sec.code, v));
                                        touch();
                                      }}
                                    />
                                  </span>
                                </div>
                              );
                            })}
                            <div style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>
                              Sector rows are a sub-allocation inside this Theater; only Theater-level rows
                              count toward the 100% total above.
                            </div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11.5, color: FAINT, marginTop: 8 }}>
                            No sectors recorded for this Theater yet.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Section>

            {/* ── E. Difficulty ───────────────────────────────────────────── */}
            <Section id="sec-e" title="Difficulty">
              <Grid>
                <Field label="Difficulty curve">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ flex: 1 }}>
                      <Select
                        disabled={readOnly}
                        value={String(config.difficulty_curve ?? "flat")}
                        onChange={(v) => setCfg("difficulty_curve", v)}
                        options={DIFFICULTY_CURVES.map((c) => ({ value: c, label: cap(c) }))}
                      />
                    </span>
                    <span
                      title="Shape across the season"
                      style={{ border: "1px solid var(--color-cream-border)", borderRadius: 6, padding: 3, background: "#fff" }}
                    >
                      <Sparkline points={curvePoints(String(config.difficulty_curve ?? "flat"), 28)} />
                    </span>
                  </div>
                </Field>
                <Field label="Target solve rate">
                  <NumberInput
                    disabled={readOnly}
                    value={config.target_solve_rate_pct as number | null}
                    onChange={(v) => setCfg("target_solve_rate_pct", v)}
                    suffix="%"
                    step={0.5}
                  />
                </Field>
              </Grid>

              <div style={{ marginTop: 18 }}>
                <TotalBar
                  total={difficultyTotal}
                  disabled={readOnly}
                  onNormalize={() => { setDifficultyMix(normalizeBands(difficultyMix)); touch(); }}
                  onEven={() => { setDifficultyMix(evenBands(difficultyMix)); touch(); }}
                />
                {DIFFICULTY_BANDS.map((band) => {
                  const row = baseDifficulty.find((d) => d.difficulty_band === band);
                  return (
                    <div key={band} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderTop: "1px solid var(--color-cream-line)" }}>
                      <span style={{ fontSize: 13, color: INK, flex: 1, minWidth: 110 }}>{cap(band)}</span>
                      <span style={{ width: 280 }}>
                        <PercentControl
                          disabled={readOnly}
                          value={row?.target_pct ?? 0}
                          onChange={(v) => { setDifficultyMix(upsertBand(difficultyMix, band, null, v)); touch(); }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* per-game overrides */}
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <span className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT }}>
                    Game-specific overrides
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    <AddOverride
                      disabled={readOnly}
                      catalog={bundle.catalog}
                      used={new Set(difficultyMix.map((d) => d.applies_to_game_id).filter(Boolean) as string[])}
                      onAdd={(gameId) => {
                        setDifficultyMix((rows) => [
                          ...rows,
                          ...DIFFICULTY_BANDS.map((b, i) => ({
                            difficulty_band: b,
                            target_pct: [30, 50, 20][i],
                            min_pct: null,
                            max_pct: null,
                            applies_to_game_id: gameId,
                          })),
                        ]);
                        touch();
                      }}
                    />
                  </span>
                </div>

                {overrideGroups(difficultyMix).length === 0 ? (
                  <div style={{ fontSize: 12, color: FAINT }}>
                    None — every game uses the season-wide band mix above.
                  </div>
                ) : (
                  overrideGroups(difficultyMix).map((gameId) => {
                    const rows = difficultyMix.filter((d) => d.applies_to_game_id === gameId);
                    const total = sumPct(rows.map((r) => r.target_pct));
                    return (
                      <div key={gameId} style={{ border: "1px solid var(--color-cream-border)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <strong style={{ fontSize: 13, color: INK }}>
                            {catalogById.get(gameId)?.display_name ?? "Unknown game"}
                          </strong>
                          <span
                            className="font-mono"
                            style={{ fontSize: 11, color: isHundred(total) ? "#4f6b4d" : "#94560a" }}
                          >
                            {total}%
                          </span>
                          <span style={{ marginLeft: "auto" }}>
                            <MiniButton
                              tone="danger"
                              disabled={readOnly}
                              onClick={() => {
                                setDifficultyMix((r) => r.filter((x) => x.applies_to_game_id !== gameId));
                                touch();
                              }}
                            >
                              Remove
                            </MiniButton>
                          </span>
                        </div>
                        {DIFFICULTY_BANDS.map((band) => {
                          const row = rows.find((r) => r.difficulty_band === band);
                          return (
                            <div key={band} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
                              <span style={{ fontSize: 12.5, color: MUTED, flex: 1 }}>{cap(band)}</span>
                              <span style={{ width: 260 }}>
                                <PercentControl
                                  disabled={readOnly}
                                  value={row?.target_pct ?? 0}
                                  onChange={(v) => { setDifficultyMix(upsertBand(difficultyMix, band, gameId, v)); touch(); }}
                                />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>
            </Section>

            {/* ── F. Teams & participation ────────────────────────────────── */}
            <Section id="sec-f" title="Teams & participation">
              <Grid cols={3}>
                <Field
                  label="Max teams per subscriber"
                  hint="Lowering this warns with the number of subscribers already over the new limit. No membership is ever removed automatically."
                >
                  <Stepper
                    disabled={readOnly}
                    min={1}
                    max={10}
                    value={Number(config.max_teams_per_subscriber ?? 1)}
                    onChange={(v) => setCfg("max_teams_per_subscriber", v)}
                  />
                </Field>
                <Field label="Min team size">
                  <NumberInput
                    disabled={readOnly}
                    min={1}
                    value={config.min_team_size as number}
                    onChange={(v) => setCfg("min_team_size", v ?? 1)}
                  />
                </Field>
                <Field label="Max team size" hint="Empty = unlimited.">
                  <NumberInput
                    disabled={readOnly}
                    min={1}
                    value={config.max_team_size as number | null}
                    onChange={(v) => setCfg("max_team_size", v)}
                  />
                </Field>
              </Grid>

              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                <Toggle
                  disabled={readOnly}
                  checked={config.allow_free_agency === true}
                  onChange={(v) => setCfg("allow_free_agency", v)}
                  label="Allow free agency"
                />
                <Toggle
                  disabled={readOnly}
                  checked={config.allow_late_join === true}
                  onChange={(v) => setCfg("allow_late_join", v)}
                  label="Allow late join"
                />
                <Toggle
                  disabled={readOnly}
                  checked={config.allow_mid_season_team_switch === true}
                  onChange={(v) => setCfg("allow_mid_season_team_switch", v)}
                  label="Allow mid-season team switch"
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <Grid cols={3}>
                  <Field label="Registration opens">
                    <TextInput type="date" disabled={readOnly} value={dateVal(config.registration_opens_on)} onChange={(v) => setCfg("registration_opens_on", v || null)} />
                  </Field>
                  <Field label="Registration closes">
                    <TextInput type="date" disabled={readOnly} value={dateVal(config.registration_closes_on)} onChange={(v) => setCfg("registration_closes_on", v || null)} />
                  </Field>
                  <Field label="Roster lock">
                    <TextInput type="date" disabled={readOnly} value={dateVal(config.roster_lock_on)} onChange={(v) => setCfg("roster_lock_on", v || null)} />
                  </Field>
                </Grid>
              </div>
            </Section>

            {/* ── G. Scoring ──────────────────────────────────────────────── */}
            <Section id="sec-g" title="Scoring">
              <Grid cols={3}>
                <Field label="Scoring profile">
                  <TextInput disabled={readOnly} value={String(config.scoring_profile ?? "standard")} onChange={(v) => setCfg("scoring_profile", v)} />
                </Field>
                <Field label="Signals per correct">
                  <NumberInput disabled={readOnly} min={0} value={config.signals_per_correct as number} onChange={(v) => setCfg("signals_per_correct", v ?? 0)} />
                </Field>
                <Field label="Drop lowest N days">
                  <NumberInput disabled={readOnly} min={0} value={config.drop_lowest_n_days as number} onChange={(v) => setCfg("drop_lowest_n_days", v ?? 0)} />
                </Field>
              </Grid>

              <div style={{ marginTop: 12 }}>
                <Toggle
                  disabled={readOnly}
                  checked={config.streak_bonus_enabled === true}
                  onChange={(v) => setCfg("streak_bonus_enabled", v)}
                  label="Streak bonus enabled"
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <Grid cols={3}>
                  <Field label="Team score method">
                    <Select
                      disabled={readOnly}
                      value={String(config.team_score_method ?? "sum")}
                      onChange={(v) => setCfg("team_score_method", v)}
                      options={TEAM_SCORE_METHODS.map((m) => ({ value: m, label: m === "top_n" ? "Top N" : cap(m) }))}
                    />
                  </Field>
                  {config.team_score_method === "top_n" ? (
                    <Field label="Top N" hint="Required when the method is Top N.">
                      <NumberInput
                        disabled={readOnly}
                        min={1}
                        value={config.team_score_top_n as number | null}
                        onChange={(v) => setCfg("team_score_top_n", v)}
                      />
                    </Field>
                  ) : null}
                  <Field label="Late submission grace">
                    <NumberInput
                      disabled={readOnly}
                      min={0}
                      value={config.late_submission_grace_hours as number}
                      onChange={(v) => setCfg("late_submission_grace_hours", v ?? 0)}
                      suffix="hrs"
                    />
                  </Field>
                </Grid>
              </div>

              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--color-cream-line)" }}>
                <Toggle
                  disabled={readOnly}
                  checked={config.hints_enabled === true}
                  onChange={(v) => setCfg("hints_enabled", v)}
                  label="Hints enabled"
                />
                <div style={{ marginTop: 12 }}>
                  <Grid>
                    <Field label="Max hints per game">
                      <NumberInput disabled={readOnly || config.hints_enabled !== true} min={0} value={config.max_hints_per_game as number} onChange={(v) => setCfg("max_hints_per_game", v ?? 0)} />
                    </Field>
                    <Field label="Hint penalty">
                      <NumberInput disabled={readOnly || config.hints_enabled !== true} min={0} max={100} step={0.5} value={config.hint_penalty_pct as number} onChange={(v) => setCfg("hint_penalty_pct", v ?? 0)} suffix="%" />
                    </Field>
                  </Grid>
                </div>
              </div>
            </Section>

            {/* ── H. Visibility ───────────────────────────────────────────── */}
            <Section id="sec-h" title="Visibility">
              <Toggle
                disabled={readOnly}
                checked={config.publish_leaderboard === true}
                onChange={(v) => setCfg("publish_leaderboard", v)}
                label="Publish leaderboard"
              />
              <div style={{ marginTop: 14 }}>
                <Grid>
                  <Field label="Leaderboard visibility">
                    <Select
                      disabled={readOnly || config.publish_leaderboard !== true}
                      value={String(config.leaderboard_visibility ?? "public")}
                      onChange={(v) => setCfg("leaderboard_visibility", v)}
                      options={LEADERBOARD_VISIBILITIES.map((v) => ({ value: v, label: cap(v) }))}
                    />
                  </Field>
                  <Field label="Publish standings at" hint="Empty = as soon as the season opens.">
                    <TextInput
                      type="datetime-local"
                      disabled={readOnly}
                      value={toLocalInput(config.publish_standings_at)}
                      onChange={(v) => setCfg("publish_standings_at", v ? new Date(v).toISOString() : null)}
                    />
                  </Field>
                </Grid>
              </div>
            </Section>

            {/* ── I. Advanced ─────────────────────────────────────────────── */}
            <Section id="sec-i" title="Advanced">
              <ExtrasEditor
                disabled={readOnly}
                value={(config.extras as Record<string, unknown>) ?? {}}
                onChange={(v) => setCfg("extras", v)}
              />
            </Section>
          </div>
        </div>
      </div>

      {/* ── sticky footer ───────────────────────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          left: 236,
          right: 0,
          bottom: 0,
          background: "#fff",
          borderTop: "1px solid var(--color-cream-border)",
          padding: "12px 28px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          boxShadow: "0 -4px 18px rgba(20,18,16,.06)",
          zIndex: 20,
        }}
      >
        <span className="font-mono" style={{ fontSize: 10.5, color: dirty ? "#94560a" : FAINT, letterSpacing: ".06em", textTransform: "uppercase" }}>
          {dirty ? "● Unsaved changes" : "Saved"}
        </span>
        <span
          className="font-mono"
          style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: errorCount ? "#9c3b2e" : FAINT }}
        >
          {summarizeFindings(findings)}
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!readOnly && (bundle.config.state === "draft" || bundle.config.state === "scheduled") ? (
            <MiniButton tone="danger" disabled={busy} onClick={() => setDialog("cancel")}>
              Cancel version
            </MiniButton>
          ) : null}
          {readOnly ? (
            bundle.config.state === "active" ? (
              <PrimaryButton onClick={clone} disabled={busy}>
                Clone to new version
              </PrimaryButton>
            ) : null
          ) : (
            <>
              <MiniButton disabled={busy || !dirty} onClick={() => setDialog("save")}>
                Save draft
              </MiniButton>
              <PrimaryButton
                disabled={busy || errorCount > 0}
                title={errorCount > 0 ? "Resolve the blocking errors first." : undefined}
                onClick={() => setDialog("promote")}
              >
                {intent.label}
              </PrimaryButton>
            </>
          )}
        </span>
      </div>

      {/* ── dialogs ─────────────────────────────────────────────────────────── */}
      <ReasonDialog
        open={dialog === "save"}
        busy={busy}
        title="Save draft"
        description={
          pendingCapAck
            ? "Some subscribers already hold more teams than the new cap. Saving does NOT remove any membership — it only applies from here on."
            : "Saves this version's configuration. It does not take effect until the version is promoted."
        }
        confirmLabel={pendingCapAck ? "Save anyway" : "Save draft"}
        destructive={pendingCapAck}
        onCancel={() => { setDialog(null); setPendingCapAck(false); }}
        onConfirm={(reason) => save(reason, pendingCapAck)}
      />

      <ReasonDialog
        open={dialog === "promote"}
        busy={busy}
        title={intent.action === "schedule" ? "Schedule this version" : "Promote this version"}
        description={
          intent.action === "schedule" ? (
            <>
              This version becomes <strong>scheduled</strong> and flips to active automatically at{" "}
              <strong>{formatExact(config.effective_from)}</strong>. The current active version stays
              in force until then.
            </>
          ) : (
            <>
              This version becomes <strong>active immediately</strong> (
              {formatExact(config.effective_from)}) and the current active version is superseded.
            </>
          )
        }
        details={<PromoteDiff incumbent={incumbent} next={config} />}
        confirmLabel={intent.action === "schedule" ? "Schedule" : "Promote now"}
        onCancel={() => setDialog(null)}
        onConfirm={promote}
      />

      <ReasonDialog
        open={dialog === "cancel"}
        busy={busy}
        title="Cancel this version"
        description="Marks the version cancelled. It stays in the history but can never be promoted."
        confirmLabel="Cancel version"
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={cancelVersion}
      />
    </div>
  );
}

// ── slate table ──────────────────────────────────────────────────────────────

// The game column gets a real minimum so the name never collapses to an ellipsis
// (it used to share a 1.4fr slot that the fixed columns squeezed to ~28px inside
// the 900px min-width — that is why names rendered as "T..").
const SLATE_COLS = "34px 30px minmax(230px, 1.8fr) 90px 78px 84px 108px 108px 150px 118px";

function SlateHeader() {
  return (
    <div
      className="font-mono"
      style={{
        display: "grid",
        gridTemplateColumns: SLATE_COLS,
        gap: 8,
        padding: "9px 6px",
        fontSize: 9.5,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: FAINT,
        background: "var(--color-warm-panel)",
        borderRadius: "8px 8px 0 0",
        border: "1px solid var(--color-cream-border)",
      }}
    >
      <div />
      <div>On</div>
      <div>Game</div>
      <div style={{ textAlign: "right" }}>Weight</div>
      <div style={{ textAlign: "right" }}>Points</div>
      <div>Floor</div>
      <div>Ceiling</div>
      <div>Days</div>
      <div>Window</div>
      <div>Order</div>
    </div>
  );
}

function SlateRow({
  row, index, game, disabled, onChange, onMove, onDropRow, isFirst, isLast,
}: {
  row: GameRow;
  index: number;
  game: GameCatalogRow | undefined;
  disabled?: boolean;
  onChange: (next: GameRow) => void;
  onMove: (dir: -1 | 1) => void;
  onDropRow: (fromIndex: number) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [over, setOver] = useState(false);
  const set = (patch: Partial<GameRow>) => onChange({ ...row, ...patch });

  const bands = [
    { value: "", label: "—" },
    ...DIFFICULTY_BANDS.map((b) => ({ value: b, label: cap(b) })),
  ];

  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(index))}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const from = Number(e.dataTransfer.getData("text/plain"));
        if (Number.isInteger(from) && from !== index) onDropRow(from);
      }}
      style={{
        display: "grid",
        gridTemplateColumns: SLATE_COLS,
        gap: 8,
        padding: "9px 6px",
        alignItems: "center",
        borderLeft: "1px solid var(--color-cream-border)",
        borderRight: "1px solid var(--color-cream-border)",
        borderBottom: "1px solid var(--color-cream-line)",
        background: over ? "rgba(196,146,42,.10)" : row.is_enabled ? "#fff" : "#fdfcfa",
        opacity: row.is_enabled ? 1 : 0.66,
      }}
    >
      <div
        title={disabled ? undefined : "Drag to reorder"}
        style={{ cursor: disabled ? "default" : "grab", color: FAINT, fontSize: 13, textAlign: "center", userSelect: "none" }}
        aria-hidden
      >
        ⠿
      </div>

      <div>
        <input
          type="checkbox"
          checked={row.is_enabled}
          disabled={disabled}
          onChange={(e) => set({ is_enabled: e.target.checked })}
          aria-label={`Enable ${game?.display_name ?? "game"}`}
          style={{ accentColor: GOLD, cursor: disabled ? "not-allowed" : "pointer" }}
        />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: INK, fontWeight: 600, lineHeight: 1.25 }}>
          {game?.display_name ?? "Unknown game"}
        </div>
        {game?.description ? (
          <div
            style={{
              fontSize: 11,
              color: MUTED,
              marginTop: 2,
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
            title={game.description}
          >
            {game.description}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
          {game?.category ? (
            <span className="font-mono" style={{ fontSize: 8.5, letterSpacing: ".08em", textTransform: "uppercase", color: FAINT, border: "1px solid var(--color-cream-border)", borderRadius: 4, padding: "1px 4px" }}>
              {game.category}
            </span>
          ) : null}
          {game?.is_beta ? <StatusChip label="beta" tone="amber" /> : null}
        </div>
      </div>

      <div><NumberInput disabled={disabled} step={0.001} min={0} value={row.weight} onChange={(v) => set({ weight: v ?? 0 })} /></div>
      <div><NumberInput disabled={disabled} min={0} value={row.points_override} onChange={(v) => set({ points_override: v })} placeholder={String(game?.default_points ?? "")} /></div>
      <div><Select disabled={disabled} value={row.difficulty_floor ?? ""} onChange={(v) => set({ difficulty_floor: v || null })} options={bands} /></div>
      <div><Select disabled={disabled} value={row.difficulty_ceiling ?? ""} onChange={(v) => set({ difficulty_ceiling: v || null })} options={bands} /></div>
      <div><DayMask disabled={disabled} value={row.appears_on_days} onChange={(v) => set({ appears_on_days: v })} /></div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <input
          type="date"
          value={row.starts_on ?? ""}
          disabled={disabled}
          onChange={(e) => set({ starts_on: e.target.value || null })}
          aria-label="Starts on"
          style={miniInput}
        />
        <input
          type="date"
          value={row.ends_on ?? ""}
          disabled={disabled}
          onChange={(e) => set({ ends_on: e.target.value || null })}
          aria-label="Ends on"
          style={miniInput}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button type="button" disabled={disabled || isFirst} onClick={() => onMove(-1)} aria-label="Move up" style={arrowBtn}>↑</button>
        <button type="button" disabled={disabled || isLast} onClick={() => onMove(1)} aria-label="Move down" style={arrowBtn}>↓</button>
        <span className="font-mono" style={{ fontSize: 10.5, color: FAINT }}>{row.sort_order}</span>
      </div>
    </div>
  );
}

const miniInput: React.CSSProperties = {
  border: "1px solid var(--color-cream-border)",
  borderRadius: 5,
  padding: "3px 5px",
  fontSize: 11,
  fontFamily: "inherit",
  color: INK,
  width: "100%",
};

const arrowBtn: React.CSSProperties = {
  border: "1px solid var(--color-cream-border)",
  background: "#fff",
  borderRadius: 4,
  width: 20,
  height: 20,
  fontSize: 10,
  cursor: "pointer",
  color: MUTED,
  lineHeight: 1,
  padding: 0,
};

// ── small pieces ─────────────────────────────────────────────────────────────

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

function MultiSelect({
  label, options, selected, onToggle, disabled,
}: {
  label: string;
  options: { id: string; name: string; code?: string }[];
  selected: string[];
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
            const on = selected.includes(o.id);
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

function AddOverride({
  catalog, used, onAdd, disabled,
}: {
  catalog: GameCatalogRow[];
  used: Set<string>;
  onAdd: (gameId: string) => void;
  disabled?: boolean;
}) {
  const available = catalog.filter((c) => !used.has(c.id));
  const [value, setValue] = useState("");
  if (!available.length) return null;

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        style={{ ...miniInput, width: 160, padding: "5px 7px", fontSize: 12 }}
        aria-label="Game to override"
      >
        <option value="">Add game-specific mix…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>{c.display_name}</option>
        ))}
      </select>
      <MiniButton
        disabled={disabled || !value}
        onClick={() => { if (value) { onAdd(value); setValue(""); } }}
      >
        Add
      </MiniButton>
    </span>
  );
}

/** Raw jsonb editor — schema-free by design (spec §2.4 Section I). */
function ExtrasEditor({
  value, onChange, disabled,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <MiniButton onClick={() => setOpen(true)}>
        Show raw extras ({Object.keys(value ?? {}).length} key{Object.keys(value ?? {}).length === 1 ? "" : "s"})
      </MiniButton>
    );

  return (
    <div>
      <TextArea
        mono
        rows={8}
        disabled={disabled}
        value={text}
        onChange={(v) => {
          setText(v);
          try {
            const parsed = JSON.parse(v || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              setError(null);
              onChange(parsed as Record<string, unknown>);
            } else {
              setError("Extras must be a JSON object.");
            }
          } catch {
            setError("Not valid JSON — the last valid value is kept.");
          }
        }}
      />
      {error ? (
        <div style={{ fontSize: 11.5, color: "#9c3b2e", marginTop: 6 }}>{error}</div>
      ) : (
        <div style={{ fontSize: 11.5, color: FAINT, marginTop: 6 }}>Valid JSON object.</div>
      )}
      <div style={{ marginTop: 8 }}>
        <MiniButton onClick={() => setOpen(false)}>Hide</MiniButton>
      </div>
    </div>
  );
}

function PromoteDiff({
  incumbent, next,
}: {
  incumbent: SeasonConfigRow | null;
  next: Record<string, unknown>;
}) {
  const rows = diffConfigs(incumbent as unknown as Record<string, unknown> | null, next);

  return (
    <div style={{ border: "1px solid var(--color-cream-border)", borderRadius: 8, overflow: "hidden" }}>
      <div
        className="font-mono"
        style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, padding: "8px 12px", background: "var(--color-warm-panel)" }}
      >
        {incumbent ? `Changes vs v${incumbent.version} (currently live)` : "No version is live yet — this becomes the first"}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "12px", fontSize: 12.5, color: MUTED }}>
          No configuration fields differ from the live version.
        </div>
      ) : (
        <div style={{ maxHeight: 240, overflowY: "auto" }}>
          {rows.map((r) => (
            <div
              key={r.field}
              style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 10, padding: "7px 12px", borderTop: "1px solid var(--color-cream-line)", fontSize: 12 }}
            >
              <span style={{ color: INK }}>{fieldLabel(r.field)}</span>
              <span className="font-mono" style={{ color: FAINT, textDecoration: "line-through" }}>{formatValue(r.before)}</span>
              <span className="font-mono" style={{ color: "#4f6b4d" }}>{formatValue(r.after)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── pure helpers ─────────────────────────────────────────────────────────────

/** Catalog-driven slate: every catalog game gets a row, whether or not the
 *  config already has one. This is what makes an 8th game appear for free. */
function mergeSlate(catalog: GameCatalogRow[], existing: ConfigBundle["games"]): GameRow[] {
  const byGame = new Map(existing.map((g) => [g.game_id, g]));
  return catalog
    .map((c) => {
      const e = byGame.get(c.id);
      return {
        game_id: c.id,
        is_enabled: e ? e.is_enabled : false,
        weight: e ? Number(e.weight) : 1,
        points_override: e?.points_override ?? null,
        difficulty_floor: e?.difficulty_floor ?? null,
        difficulty_ceiling: e?.difficulty_ceiling ?? null,
        appears_on_days: e?.appears_on_days ?? null,
        starts_on: e?.starts_on ?? null,
        ends_on: e?.ends_on ?? null,
        sort_order: e?.sort_order ?? c.sort_order,
        notes: e?.notes ?? null,
      };
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

function reorder(rows: GameRow[], from: number, to: number): GameRow[] {
  if (to < 0 || to >= rows.length || from === to) return rows;
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  // Re-stamp sort_order so the persisted order matches what is on screen.
  return next.map((r, i) => ({ ...r, sort_order: (i + 1) * 10 }));
}

function initialScopeMode(bundle: ConfigBundle): ScopeMode {
  const included = bundle.scopes.filter((s) => !s.is_excluded);
  if (!included.length || included.some((s) => s.scope_type === "platform")) return "platform";
  return included[0].scope_type === "conference" ? "conferences" : "leagues";
}

const toggleIn = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

function theaterList(taxonomy: ThemeTheater[], mix: ThemeRow[]): ThemeTheater[] {
  if (taxonomy.length) return taxonomy;
  // Fall back to whatever the config already allocates, so an empty taxonomy
  // never hides existing rows.
  const ids = [...new Set(mix.map((m) => m.theater_id))];
  return ids.map((id) => ({ theater_id: id, theater_name: id, sectors: [] }));
}

function upsertTheater(mix: ThemeRow[], theaterId: string, patch: Partial<ThemeRow>): ThemeRow[] {
  const idx = mix.findIndex((r) => r.theater_id === theaterId && !r.sector_code && !r.thread_code);
  if (idx === -1)
    return [
      ...mix,
      { theater_id: theaterId, sector_code: null, thread_code: null, target_pct: 0, min_pct: null, max_pct: null, is_excluded: false, ...patch },
    ];
  return mix.map((r, i) => (i === idx ? { ...r, ...patch } : r));
}

function upsertSector(mix: ThemeRow[], theaterId: string, sectorCode: string, pct: number): ThemeRow[] {
  const idx = mix.findIndex((r) => r.theater_id === theaterId && r.sector_code === sectorCode && !r.thread_code);
  if (idx === -1)
    return [
      ...mix,
      { theater_id: theaterId, sector_code: sectorCode, thread_code: null, target_pct: pct, min_pct: null, max_pct: null, is_excluded: false },
    ];
  return mix.map((r, i) => (i === idx ? { ...r, target_pct: pct } : r));
}

/** Normalize only the Theater-level, non-excluded rows — those are the ones the
 *  100% total is computed over. */
function normalizeThemeRows(mix: ThemeRow[]): ThemeRow[] {
  const targets = mix.filter((r) => !r.sector_code && !r.thread_code && !r.is_excluded);
  const scaled = normalizeTo100(targets.map((r) => r.target_pct));
  let i = 0;
  return mix.map((r) =>
    !r.sector_code && !r.thread_code && !r.is_excluded ? { ...r, target_pct: scaled[i++] } : r
  );
}

function evenThemeRows(mix: ThemeRow[], taxonomy: ThemeTheater[]): ThemeRow[] {
  const ids = taxonomy.length
    ? taxonomy.map((t) => t.theater_id)
    : [...new Set(mix.filter((m) => !m.sector_code).map((m) => m.theater_id))];
  const excluded = new Set(mix.filter((r) => r.is_excluded && !r.sector_code).map((r) => r.theater_id));
  const live = ids.filter((id) => !excluded.has(id));
  const pcts = evenSplit(live.length);

  let out = mix;
  live.forEach((id, i) => { out = upsertTheater(out, id, { target_pct: pcts[i] }); });
  return out;
}

function upsertBand(mix: DiffRow[], band: string, gameId: string | null, pct: number): DiffRow[] {
  const idx = mix.findIndex((d) => d.difficulty_band === band && (d.applies_to_game_id ?? null) === gameId);
  if (idx === -1)
    return [...mix, { difficulty_band: band, target_pct: pct, min_pct: null, max_pct: null, applies_to_game_id: gameId }];
  return mix.map((d, i) => (i === idx ? { ...d, target_pct: pct } : d));
}

function normalizeBands(mix: DiffRow[]): DiffRow[] {
  const base = mix.filter((d) => !d.applies_to_game_id);
  const scaled = normalizeTo100(base.map((d) => d.target_pct));
  let i = 0;
  return mix.map((d) => (!d.applies_to_game_id ? { ...d, target_pct: scaled[i++] } : d));
}

function evenBands(mix: DiffRow[]): DiffRow[] {
  const pcts = evenSplit(DIFFICULTY_BANDS.length);
  let out = mix;
  DIFFICULTY_BANDS.forEach((b, i) => { out = upsertBand(out, b, null, pcts[i]); });
  return out;
}

const overrideGroups = (mix: DiffRow[]) =>
  [...new Set(mix.map((d) => d.applies_to_game_id).filter(Boolean) as string[])];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

const dateVal = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");

/** ISO → the value a datetime-local input expects (local wall clock). */
function toLocalInput(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatExact(v: unknown): string {
  if (typeof v !== "string" || !v) return "now";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "now";
  return `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
