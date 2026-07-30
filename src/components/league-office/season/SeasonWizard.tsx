"use client";

// League Office — New Season wizard (spec §2.2).
//
// Four steps, one card each, progress rail on the left. NOTHING is written
// until step 4 submits: the whole draft lives in client state and lands as one
// POST that creates the season, its scope rows and its v1 draft config.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import {
  Callout, FAINT, Field, GOLD, Grid, INK, MiniButton, MUTED, PrimaryButton,
  Section, TextArea, TextInput,
} from "./fields";
import { slugify, validateWindow, windowSummary } from "@/lib/league-office/season-config-logic";
import type { ScopeOptions } from "@/lib/league-office/seasons";

type SeasonOption = { id: string; name: string; slug: string };

const STEPS = [
  { n: 1, label: "Identity" },
  { n: 2, label: "Window" },
  { n: 3, label: "Scope" },
  { n: 4, label: "Starting point" },
];

export default function SeasonWizard({
  scopeOptions,
  seasons,
  existingSlugs,
  initialCopyFrom,
}: {
  scopeOptions: ScopeOptions;
  seasons: SeasonOption[];
  existingSlugs: string[];
  /** Set by "Duplicate season" on the index (?copyFrom=<id>) — preselects the
   *  copy source so the menu item lands somewhere useful. */
  initialCopyFrom?: string;
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

  // step 2
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [faStart, setFaStart] = useState("");
  const [faNotice, setFaNotice] = useState("");
  const [rosterLock, setRosterLock] = useState("");

  // step 3
  const [scopeMode, setScopeMode] = useState<"platform" | "leagues" | "conferences">("platform");
  const [scopeRefs, setScopeRefs] = useState<string[]>([]);
  const [scopeExcludes, setScopeExcludes] = useState<string[]>([]);

  // step 4
  const validCopyFrom = initialCopyFrom && seasons.some((s) => s.id === initialCopyFrom) ? initialCopyFrom : "";
  const [startMode, setStartMode] = useState<"defaults" | "copy">(validCopyFrom ? "copy" : "defaults");
  const [sourceSeasonId, setSourceSeasonId] = useState(validCopyFrom);

  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const slugTaken = !!effectiveSlug && existingSlugs.includes(effectiveSlug);

  const windowErrors = useMemo(
    () =>
      validateWindow({
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        free_agency_start: faStart || null,
        free_agency_notice_start: faNotice || null,
      }),
    [startsOn, endsOn, faStart, faNotice]
  );

  const summary = useMemo(() => windowSummary(startsOn, endsOn), [startsOn, endsOn]);

  const step1Ok = !!name.trim() && !!effectiveSlug && !slugTaken;
  const step2Ok = windowErrors.length === 0 && !!startsOn && !!endsOn;
  const step3Ok = scopeMode === "platform" || scopeRefs.length > 0;
  const step4Ok = startMode === "defaults" || !!sourceSeasonId;
  const canSubmit = step1Ok && step2Ok && step3Ok && step4Ok;

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
          free_agency_start: faStart || null,
          free_agency_notice_start: faNotice || null,
          roster_lock_on: rosterLock || null,
          scope: { mode: scopeMode, refIds: scopeRefs, excludeIds: scopeExcludes },
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

          {/* ── 2. Window ───────────────────────────────────────────────── */}
          {step === 2 ? (
            <Section id="w2" title="Window">
              <Grid>
                <Field label="Starts on"><TextInput type="date" value={startsOn} onChange={setStartsOn} /></Field>
                <Field label="Ends on"><TextInput type="date" value={endsOn} onChange={setEndsOn} /></Field>
              </Grid>
              <div style={{ marginTop: 14 }}>
                <Grid cols={3}>
                  <Field label="Free agency opens"><TextInput type="date" value={faStart} onChange={setFaStart} /></Field>
                  <Field label="Free agency notice"><TextInput type="date" value={faNotice} onChange={setFaNotice} /></Field>
                  <Field label="Roster lock" hint="Written to the v1 config."><TextInput type="date" value={rosterLock} onChange={setRosterLock} /></Field>
                </Grid>
              </div>

              {summary ? (
                <div className="font-mono" style={{ fontSize: 12, color: MUTED, marginTop: 16 }}>
                  {summary.days} days · {summary.playDays} play days
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

          {/* ── 3. Scope ────────────────────────────────────────────────── */}
          {step === 3 ? (
            <Section id="w3" title="Scope" blurb="Which leagues or conferences this season applies to.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                <WizardRadio checked={scopeMode === "platform"} onChange={() => setScopeMode("platform")} label="All leagues (platform)" />
                <WizardRadio checked={scopeMode === "leagues"} onChange={() => setScopeMode("leagues")} label="Specific leagues" />
                <WizardRadio
                  checked={scopeMode === "conferences"}
                  onChange={() => setScopeMode("conferences")}
                  disabled={!scopeOptions.conferences.length}
                  label={scopeOptions.conferences.length ? "Specific conferences" : "Specific conferences (none defined yet)"}
                />
              </div>

              {scopeMode !== "platform" ? (
                <Chips
                  label={scopeMode === "leagues" ? "Included leagues" : "Included conferences"}
                  options={scopeMode === "leagues" ? scopeOptions.leagues : scopeOptions.conferences}
                  selected={scopeRefs}
                  onToggle={(id) => setScopeRefs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                />
              ) : null}

              <div style={{ marginTop: 16 }}>
                <Chips
                  label="Exclude (optional)"
                  options={scopeMode === "conferences" ? scopeOptions.conferences : scopeOptions.leagues}
                  selected={scopeExcludes}
                  onToggle={(id) => setScopeExcludes((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                />
              </div>

              {!step3Ok ? (
                <div style={{ marginTop: 14 }}>
                  <Callout tone="warning">Choose at least one {scopeMode === "leagues" ? "league" : "conference"}, or switch to all leagues.</Callout>
                </div>
              ) : null}
            </Section>
          ) : null}

          {/* ── 4. Starting point ───────────────────────────────────────── */}
          {step === 4 ? (
            <Section id="w4" title="Starting point">
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
                <Review label="Timezone" value={tz} mono />
                <Review
                  label="Scope"
                  value={
                    scopeMode === "platform"
                      ? "All leagues"
                      : `${scopeRefs.length} ${scopeMode === "leagues" ? "league" : "conference"}${scopeRefs.length === 1 ? "" : "s"}${scopeExcludes.length ? ` · ${scopeExcludes.length} excluded` : ""}`
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
              {step < 4 ? (
                <PrimaryButton
                  disabled={(step === 1 && !step1Ok) || (step === 2 && !step2Ok) || (step === 3 && !step3Ok)}
                  onClick={() => setStep((s) => Math.min(4, s + 1))}
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

function Chips({
  label, options, selected, onToggle,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
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
                onClick={() => onToggle(o.id)}
                aria-pressed={on}
                style={{
                  fontSize: 12, padding: "5px 10px", borderRadius: 999,
                  border: `1px solid ${on ? GOLD : "var(--color-cream-border)"}`,
                  background: on ? "rgba(196,146,42,.14)" : "#fff",
                  color: on ? "#94560a" : MUTED, cursor: "pointer",
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

function Review({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ color: FAINT, width: 110, flex: "none" }}>{label}</span>
      <span className={mono ? "font-mono" : undefined} style={{ color: INK }}>{value || "—"}</span>
    </div>
  );
}
