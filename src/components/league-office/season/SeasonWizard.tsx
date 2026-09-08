"use client";

// League Office — New Season wizard (spec §2.2).
//
// Five steps, one card each, progress rail on the left. NOTHING is written
// until the last step submits: the whole draft lives in client state and lands
// as one POST that creates the season, its scope rows and its v1 draft config.
//
// Step 3 (Trading windows) is SEEDED from step 2's season dates and the
// league's default window lengths. It re-anchors silently while a field is
// untouched and stops the moment the commissioner edits it — see `tw` below.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import {
  Callout, FAINT, Field, GOLD, Grid, INK, MiniButton, MUTED, PrimaryButton,
  Provenance, Section, TextArea, TextInput,
} from "./fields";
import {
  derivedFreeAgency, findOverlappingSeason, slugify, validateWindow, windowSummary,
  FREE_AGENCY_OFFSET_DAYS, FREE_AGENCY_NOTICE_OFFSET_DAYS,
  seedTradingWindows, validateTradingWindows, mergeTradingWindows,
  seasonDayRangeLabel, TOO_SHORT_MESSAGE,
  type LeagueWindowDefaults, type TradingField, type TradingWindows,
} from "@/lib/league-office/season-config-logic";
import type { ScopeOptions } from "@/lib/league-office/seasons";
import { ScopeEditor, emptyScope, toWizardScope, type ScopeState } from "./ScopeEditor";

/** `starts_on`/`ends_on` are carried so the Window step can check the
 *  `seasons_no_overlap` exclusion constraint before submit. */
type SeasonOption = { id: string; name: string; slug: string; starts_on: string; ends_on: string };

const STEPS = [
  { n: 1, label: "Identity" },
  { n: 2, label: "Season window" },
  { n: 3, label: "Trading windows" },
  { n: 4, label: "Scope" },
  { n: 5, label: "Starting point" },
];

const LAST_STEP = STEPS.length;

export default function SeasonWizard({
  scopeOptions,
  seasons,
  existingSlugs,
  initialCopyFrom,
  leagueDefaults,
  leagueName,
}: {
  scopeOptions: ScopeOptions;
  seasons: SeasonOption[];
  existingSlugs: string[];
  /** Set by "Duplicate season" on the index (?copyFrom=<id>) — preselects the
   *  copy source so the menu item lands somewhere useful. */
  initialCopyFrom?: string;
  /** Default trading window LENGTHS from the league this wizard creates into
   *  (INDEPENDENT until a league picker exists — see season-write.ts). */
  leagueDefaults: LeagueWindowDefaults;
  leagueName: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // step 1
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [tz, setTz] = useState("America/Chicago");

  // step 2 — free agency dates are NOT collected: `seasons.free_agency_start`
  // and `free_agency_notice_start` are GENERATED ALWAYS (ends_on − 3 / − 7), so
  // they are derived and displayed, never entered.
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [rosterLock, setRosterLock] = useState("");

  // step 3 — trading windows.
  //
  // Held as OVERRIDES over the seeded values rather than as a copy of them, so
  // "re-anchor whatever the commissioner hasn't touched" needs no effect and
  // cannot race the date inputs: an untouched field reads straight through to
  // `seeded`, which recomputes whenever the season dates change. A key present
  // in `twOverrides` IS that field's dirty flag.
  const [twOverrides, setTwOverrides] = useState<Partial<Record<TradingField, string>>>({});

  // step 4 — one shared editor with the config console's Section B.
  const [scope, setScope] = useState<ScopeState>(() => emptyScope());

  // step 5
  const validCopyFrom = initialCopyFrom && seasons.some((s) => s.id === initialCopyFrom) ? initialCopyFrom : "";
  const [startMode, setStartMode] = useState<"defaults" | "copy">(validCopyFrom ? "copy" : "defaults");
  const [sourceSeasonId, setSourceSeasonId] = useState(validCopyFrom);

  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const slugTaken = !!effectiveSlug && existingSlugs.includes(effectiveSlug);

  const windowErrors = useMemo(
    () => validateWindow({ starts_on: startsOn || null, ends_on: endsOn || null }),
    [startsOn, endsOn]
  );

  const summary = useMemo(() => windowSummary(startsOn, endsOn), [startsOn, endsOn]);

  /** Shown as read-only — the DB computes these from ends_on. */
  const freeAgency = useMemo(() => derivedFreeAgency(endsOn), [endsOn]);

  /** `seasons_no_overlap` rejects overlapping windows. Caught here so the
   *  commissioner learns it at the Window step instead of at submit. */
  const overlap = useMemo(
    () => findOverlappingSeason(startsOn, endsOn, seasons),
    [startsOn, endsOn, seasons]
  );

  /** Re-derived on every season-date change. Untouched fields read straight
   *  through to this, which is what makes the silent re-anchor work. */
  const seeded = useMemo(
    () => seedTradingWindows(startsOn, endsOn, leagueDefaults),
    [startsOn, endsOn, leagueDefaults]
  );

  const tw: TradingWindows = useMemo(
    () => mergeTradingWindows(seeded.windows, twOverrides),
    [twOverrides, seeded]
  );

  const twErrors = useMemo(
    () => validateTradingWindows(tw, startsOn, endsOn),
    [tw, startsOn, endsOn]
  );

  const setTw = (f: TradingField, v: string) => setTwOverrides((o) => ({ ...o, [f]: v }));
  const resetTw = (f: TradingField) =>
    setTwOverrides((o) => {
      const next = { ...o };
      delete next[f];
      return next;
    });
  const anyOverridden = Object.keys(twOverrides).length > 0;

  const step1Ok = !!name.trim() && !!effectiveSlug && !slugTaken;
  const step2Ok = windowErrors.length === 0 && !!startsOn && !!endsOn && !overlap;
  const step3Ok = Object.keys(twErrors.fields).length === 0 && twErrors.general.length === 0;
  const step4Ok = scope.mode === "platform" || scope.refIds.length > 0;
  const step5Ok = startMode === "defaults" || !!sourceSeasonId;
  const canSubmit = step1Ok && step2Ok && step3Ok && step4Ok && step5Ok;

  const submit = async (reason: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/lo/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          description: description.trim() || undefined,
          tz,
          starts_on: startsOn,
          ends_on: endsOn,
          // free_agency_* deliberately omitted — generated by the database.
          trading_open_starts_on: tw.openStarts || null,
          trading_open_ends_on: tw.openEnds || null,
          trading_close_starts_on: tw.closeStarts || null,
          trading_close_ends_on: tw.closeEnds || null,
          roster_lock_on: rosterLock || null,
          scope: toWizardScope(scope),
          startingPoint:
            startMode === "copy"
              ? { mode: "copy", sourceSeasonId }
              : { mode: "defaults" },
          reason,
        }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Season created." : "Create failed."));

      if (res.ok && j.seasonId) {
        setConfirming(false);
        router.push(
          j.configId
            ? `/league-office/seasons/${j.seasonId}/config/${j.configId}`
            : `/league-office/seasons/${j.seasonId}`
        );
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Link href="/league-office/seasons" style={{ fontSize: 12.5, color: "var(--color-amber-dark)", textDecoration: "none" }}>
        ← Seasons
      </Link>
      <h1 className="font-serif" style={{ fontSize: 26, margin: "8px 0 0", color: INK }}>
        New season
      </h1>
      <div className="double-rule" />

      <div style={{ display: "flex", gap: 22, marginTop: 20, alignItems: "flex-start" }}>
        {/* progress rail */}
        <ol style={{ width: 168, flex: "none", listStyle: "none", margin: 0, padding: 0, position: "sticky", top: 16 }}>
          {STEPS.map((s) => {
            const done = s.n < step;
            const current = s.n === step;
            return (
              <li key={s.n} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0" }}>
                <span
                  className="font-mono"
                  style={{
                    width: 22, height: 22, borderRadius: "50%", flex: "none",
                    display: "grid", placeItems: "center", fontSize: 10.5,
                    background: current ? GOLD : done ? "rgba(196,146,42,.18)" : "#fff",
                    color: current ? "#fff" : done ? "#94560a" : FAINT,
                    border: `1px solid ${current || done ? GOLD : "var(--color-cream-border)"}`,
                  }}
                >
                  {done ? "✓" : s.n}
                </span>
                <span style={{ fontSize: 12.5, color: current ? INK : MUTED, fontWeight: current ? 600 : 400 }}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── 1. Identity ─────────────────────────────────────────────── */}
          {step === 1 ? (
            <Section id="w1" title="Identity">
              <Grid>
                <Field label="Season name">
                  <TextInput value={name} onChange={setName} placeholder="e.g. Season 5 — Post-GTC" />
                </Field>
                <Field
                  label="Slug"
                  hint={
                    slugTaken
                      ? "That slug is already taken — edit it."
                      : effectiveSlug
                        ? `Derived from the name; edit if you need something different.`
                        : "Add some letters or numbers to the name."
                  }
                >
                  <TextInput
                    mono
                    value={slugTouched ? slug : effectiveSlug}
                    onChange={(v) => { setSlugTouched(true); setSlug(v); }}
                    placeholder="season-5-post-gtc"
                  />
                </Field>
              </Grid>
              <div style={{ marginTop: 14 }}>
                <Grid>
                  <Field label="Timezone">
                    <TextInput value={tz} onChange={setTz} mono />
                  </Field>
                </Grid>
              </div>
              <div style={{ marginTop: 14 }}>
                <Field label="Description" hint="Kept with the creation record in the Audit Log.">
                  <TextArea value={description} onChange={setDescription} rows={2} />
                </Field>
              </div>
              {slugTaken ? <div style={{ marginTop: 12 }}><Callout tone="warning">The slug <strong>{effectiveSlug}</strong> already belongs to another season.</Callout></div> : null}
            </Section>
          ) : null}

          {/* ── 2. Season window ────────────────────────────────────────── */}
          {step === 2 ? (
            <Section id="w2" title="Season window">
              <Grid>
                <Field label="Starts on">
                  <TextInput type="date" value={startsOn} onChange={setStartsOn} max={endsOn || undefined} />
                </Field>
                <Field label="Ends on">
                  <TextInput type="date" value={endsOn} onChange={setEndsOn} min={startsOn || undefined} />
                </Field>
              </Grid>
              <div style={{ marginTop: 14 }}>
                <Grid cols={3}>
                  <Field label="Roster lock" hint="Written to the v1 config.">
                    <TextInput type="date" value={rosterLock} onChange={setRosterLock} />
                  </Field>
                </Grid>
              </div>

              {summary ? (
                <div className="font-mono" style={{ fontSize: 12, color: MUTED, marginTop: 16 }}>
                  {summary.days} days · {summary.playDays} play days
                </div>
              ) : null}

              {/* Free agency is DERIVED by the database, not entered. */}
              <div style={{ marginTop: 16 }}>
                <div
                  className="font-mono"
                  style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 6 }}
                >
                  Free agency (derived)
                </div>
                <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                  <Review label="Notice opens" value={freeAgency.notice ?? "—"} mono />
                  <Review label="Free agency" value={freeAgency.start ?? "—"} mono />
                </div>
                <div style={{ fontSize: 11.5, color: FAINT, marginTop: 4, lineHeight: 1.5 }}>
                  Computed by the database from the end date ({FREE_AGENCY_NOTICE_OFFSET_DAYS} and{" "}
                  {FREE_AGENCY_OFFSET_DAYS} days before it). They move automatically when you change
                  the end date and cannot be set by hand.
                </div>
              </div>

              {overlap ? (
                <div style={{ marginTop: 14 }}>
                  <Callout tone="danger">
                    These dates overlap <strong>{overlap.name}</strong> ({overlap.starts_on} →{" "}
                    {overlap.ends_on}). Seasons cannot overlap — pick a window outside it.
                  </Callout>
                </div>
              ) : null}

              {windowErrors.length ? (
                <div style={{ marginTop: 14 }}>
                  <Callout tone="warning">
                    {windowErrors.map((e) => <div key={e}>{e}</div>)}
                  </Callout>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* ── 3. Trading windows ──────────────────────────────────────── */}
          {step === 3 ? (
            <Section
              id="w3"
              title="Trading windows"
              blurb={`Seeded from the season dates and ${leagueName}'s defaults (${leagueDefaults.openDays}-day open, ${leagueDefaults.closeDays}-day close). Edit a date and it stops following the season window.`}
            >
              <TradingWindowGroup
                title="Opening window"
                fromField="openStarts"
                toField="openEnds"
                windows={tw}
                errors={twErrors.fields}
                overrides={twOverrides}
                seasonStart={startsOn}
                seasonEnd={endsOn}
                onChange={setTw}
                onReset={resetTw}
              />

              <div style={{ marginTop: 18 }}>
                <TradingWindowGroup
                  title="Closing window"
                  fromField="closeStarts"
                  toField="closeEnds"
                  windows={tw}
                  errors={twErrors.fields}
                  overrides={twOverrides}
                  seasonStart={startsOn}
                  seasonEnd={endsOn}
                  onChange={setTw}
                  onReset={resetTw}
                />
              </div>

              {seeded.tooShort ? (
                <div style={{ marginTop: 16 }}>
                  <Callout tone="warning">{TOO_SHORT_MESSAGE}</Callout>
                </div>
              ) : null}

              {twErrors.general.length ? (
                <div style={{ marginTop: 14 }}>
                  <Callout tone="warning">
                    {twErrors.general.map((e) => <div key={e}>{e}</div>)}
                  </Callout>
                </div>
              ) : null}

              {anyOverridden ? (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--color-cream-line)" }}>
                  <MiniButton onClick={() => setTwOverrides({})}>
                    Reset all to league defaults
                  </MiniButton>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* ── 4. Scope ────────────────────────────────────────────────── */}
          {step === 4 ? (
            <Section
              id="w4"
              title="Scope"
              blurb="Which leagues or conferences this season applies to, and who is carved out."
            >
              <ScopeEditor
                value={scope}
                onChange={setScope}
                options={scopeOptions}
                seasonId={null}
                note="The season does not exist yet, so teams resolve through their current conference. Once it is created, conference membership is tracked per season and this list is recalculated."
              />

              {!step4Ok ? (
                <div style={{ marginTop: 14 }}>
                  <Callout tone="warning">
                    Choose at least one {scope.mode === "leagues" ? "league" : "conference"}, or
                    switch to whole platform.
                  </Callout>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* ── 5. Starting point ───────────────────────────────────────── */}
          {step === LAST_STEP ? (
            <Section id="w5" title="Starting point">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                <WizardRadio checked={startMode === "defaults"} onChange={() => setStartMode("defaults")} label="Start from defaults" />
                <WizardRadio checked={startMode === "copy"} onChange={() => setStartMode("copy")} disabled={!seasons.length} label="Copy config from an existing season" />
              </div>

              {startMode === "copy" ? (
                <Field label="Source season">
                  <select
                    value={sourceSeasonId}
                    onChange={(e) => setSourceSeasonId(e.target.value)}
                    style={{
                      width: "100%", padding: "7px 9px", border: "1px solid var(--color-cream-border)",
                      borderRadius: 6, fontSize: 13, background: "#fff", color: INK, fontFamily: "inherit",
                    }}
                  >
                    <option value="">Choose a season…</option>
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Callout tone="info">
                  Every active game enabled, an even split across the Theaters, and a 30 / 50 / 20
                  foundational–practitioner–expert difficulty mix. All of it is editable before you
                  promote.
                </Callout>
              )}

              {startMode === "copy" ? (
                <div style={{ marginTop: 12 }}>
                  <Callout tone="info">
                    The source season&apos;s rules, slate and mixes are copied. Calendar-bound dates
                    (registration, per-game windows) are deliberately left empty — they belong to the
                    old season&apos;s window.
                  </Callout>
                </div>
              ) : null}

              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--color-cream-line)" }}>
                <div className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 8 }}>
                  Review
                </div>
                <Review label="Name" value={name} />
                <Review label="Slug" value={effectiveSlug} mono />
                <Review label="Window" value={`${startsOn || "?"} → ${endsOn || "?"}${summary ? ` · ${summary.days} days` : ""}`} />
                <Review
                  label="Free agency"
                  value={freeAgency.start ? `${freeAgency.notice} notice · ${freeAgency.start} opens (derived)` : "—"}
                />
                <Review
                  label="Trading — open"
                  value={reviewWindow(tw.openStarts, tw.openEnds, startsOn)}
                />
                <Review
                  label="Trading — close"
                  value={reviewWindow(tw.closeStarts, tw.closeEnds, startsOn)}
                />
                <Review label="Timezone" value={tz} mono />
                <Review
                  label="Scope"
                  value={
                    (scope.mode === "platform"
                      ? "Whole platform"
                      : `${scope.refIds.length} ${scope.mode === "leagues" ? "league" : "conference"}${scope.refIds.length === 1 ? "" : "s"}`) +
                    (scope.excludes.length
                      ? ` · ${scope.excludes.length} exclusion${scope.excludes.length === 1 ? "" : "s"}`
                      : "")
                  }
                />
                <Review
                  label="Starting point"
                  value={startMode === "defaults" ? "Defaults" : seasons.find((s) => s.id === sourceSeasonId)?.name ?? "—"}
                />
              </div>
            </Section>
          ) : null}

          {/* nav */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
            <MiniButton disabled={step === 1 || busy} onClick={() => setStep((s) => Math.max(1, s - 1))}>
              Back
            </MiniButton>
            <span style={{ marginLeft: "auto" }}>
              {step < LAST_STEP ? (
                <PrimaryButton
                  disabled={
                    (step === 1 && !step1Ok) || (step === 2 && !step2Ok) ||
                    (step === 3 && !step3Ok) || (step === 4 && !step4Ok)
                  }
                  onClick={() => setStep((s) => Math.min(LAST_STEP, s + 1))}
                >
                  Continue
                </PrimaryButton>
              ) : (
                <PrimaryButton disabled={!canSubmit || busy} onClick={() => setConfirming(true)}>
                  Create season
                </PrimaryButton>
              )}
            </span>
          </div>
        </div>
      </div>

      <ReasonDialog
        open={confirming}
        busy={busy}
        title="Create season"
        description={
          <>
            Creates <strong>{name}</strong> ({startsOn} → {endsOn}) with a <strong>v1 draft</strong>{" "}
            configuration. Nothing goes live until that version is promoted.
          </>
        }
        confirmLabel="Create season"
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      />
    </div>
  );
}

function WizardRadio({
  checked, onChange, label, disabled,
}: {
  checked: boolean; onChange: () => void; label: string; disabled?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: disabled ? FAINT : INK, cursor: disabled ? "not-allowed" : "pointer" }}>
      <input type="radio" name="wizard-choice" checked={checked} disabled={disabled} onChange={onChange} style={{ accentColor: GOLD }} />
      {label}
    </label>
  );
}

/** One trading window: two bound date inputs, each carrying its own provenance
 *  chip and field-level error. The inputs are bounded to the season by `min`/
 *  `max` so the picker cannot offer an out-of-range day — but a typed date
 *  still reaches `validateTradingWindows`, which is the actual gate. */
function TradingWindowGroup({
  title, fromField, toField, windows, errors, overrides, seasonStart, seasonEnd, onChange, onReset,
}: {
  title: string;
  fromField: TradingField;
  toField: TradingField;
  windows: TradingWindows;
  errors: Partial<Record<TradingField, string>>;
  overrides: Partial<Record<TradingField, string>>;
  seasonStart: string;
  seasonEnd: string;
  onChange: (f: TradingField, v: string) => void;
  onReset: (f: TradingField) => void;
}) {
  const bounds = { min: seasonStart || undefined, max: seasonEnd || undefined };
  const label = seasonDayRangeLabel(windows[fromField], windows[toField], seasonStart);

  const cell = (f: TradingField, text: string) => (
    <Field
      label={text}
      error={errors[f]}
      aside={<Provenance overridden={f in overrides} onReset={() => onReset(f)} />}
    >
      <TextInput
        type="date"
        value={windows[f]}
        onChange={(v) => onChange(f, v)}
        invalid={!!errors[f]}
        {...bounds}
      />
    </Field>
  );

  return (
    <div>
      <div
        className="font-mono"
        style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: FAINT, marginBottom: 8 }}
      >
        {title}
        {label ? <span style={{ textTransform: "none", letterSpacing: 0, color: MUTED }}> · {label}</span> : null}
      </div>
      <Grid>
        {cell(fromField, "Opens")}
        {cell(toField, "Closes")}
      </Grid>
    </div>
  );
}

/** Absolute dates plus the relative offset, e.g.
 *  "2026-01-01 → 2026-01-08 · Day 1–8 of season". */
function reviewWindow(from: string, to: string, seasonStart: string): string {
  if (!from || !to) return "—";
  const rel = seasonDayRangeLabel(from, to, seasonStart);
  return `${from} → ${to}${rel ? ` · ${rel}` : ""}`;
}

function Review({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: FAINT, width: 110, flex: "none" }}>{label}</span>
      <span className={mono ? "font-mono" : undefined} style={{ color: INK }}>{value || "—"}</span>
    </div>
  );
}
