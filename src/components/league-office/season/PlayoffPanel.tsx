"use client";

// League Playoffs — the commissioner's playoff card (League Office → Seasons →
// detail).
//
// Renders SERVER-derived state verbatim: the phase, the seeded field, and each
// matchup's points as computed from real score_events. Disabled buttons here are
// presentation only — executeAction re-validates every write, and the bracket
// itself is only ever built or refreshed by the SQL functions.
//
// There is deliberately no way to edit a result. A matchup shows "—" until its
// round's window closes; a commissioner cannot type in a winner.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import { MiniButton, PrimaryButton, Select, TextInput } from "./fields";

type Config = {
  participant_kind: string;
  qualifier_count: number;
  seeding_source: string;
} | null;

type Bracket = {
  id: string;
  participant_kind: string;
  qualifier_count: number;
  rounds: number;
  status: string;
  seeded_at: string;
  seeded_by: string | null;
  champion_participant_id: string | null;
  seeding_window_from: string;
  seeding_window_to: string;
  playoff_window_from: string;
  playoff_window_to: string;
} | null;

type Seed = { seed: number; participant_id: string; display_name: string; seed_points: number };

type Matchup = {
  id: string; round: number; slot: number;
  seed_a: number | null; seed_b: number | null;
  participant_a: string | null; participant_b: string | null;
  name_a: string | null; name_b: string | null;
  points_a: number | null; points_b: number | null;
  winner_participant_id: string | null; decided_reason: string | null;
  round_starts_on: string; round_ends_on: string;
};

type Data = {
  ok: boolean;
  phase: "pre" | "regular" | "playoff" | "post";
  playoffs_live: boolean;
  days_until_playoffs: number | null;
  roster_frozen: boolean;
  regular_window: { from: string; to: string } | null;
  playoff_window: { from: string; to: string } | null;
  season: { playoff_starts_on: string | null; roster_freeze_on: string | null };
  config: Config;
  bracket: Bracket;
  seeds: Seed[];
  matchups: Matchup[];
};

type Pending = "configure" | "seed" | "recompute" | "clear";

const ACTION: Record<Pending, string> = {
  configure: "playoff.configure",
  seed: "playoff.seed",
  recompute: "playoff.recompute",
  clear: "playoff.clear",
};

const MUTED = "#8d8375";

export function PlayoffPanel({ seasonId }: { seasonId: string }) {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft config — seeded from the server on load, edited locally until saved.
  const [kind, setKind] = useState("team");
  const [count, setCount] = useState("8");
  const [source, setSource] = useState("regular");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/lo/seasons/${seasonId}/playoff`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as Data | null;
      if (j?.ok) {
        setD(j);
        if (j.config) {
          setKind(j.config.participant_kind);
          setCount(String(j.config.qualifier_count));
          setSource(j.config.seeding_source);
        }
      }
    } catch {
      /* transient — the next action refreshes */
    }
  }, [seasonId]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (reason: string) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/league-office/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: ACTION[pending],
          reason,
          seasonId,
          ...(pending === "configure"
            ? { participantKind: kind, qualifierCount: Number(count), seedingSource: source }
            : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Done." : "That didn't work."));
      if (res.ok) { await refresh(); router.refresh(); }
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  if (!d) return <p style={{ fontSize: 12.5, color: MUTED }}>Loading playoff state…</p>;

  const noPlayoffDate = !d.season.playoff_starts_on;
  const rounds = d.bracket?.rounds ?? 0;
  const byRound = Array.from({ length: rounds }, (_, i) =>
    d.matchups.filter((m) => m.round === i + 1)
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── state banner ───────────────────────────────────────────────── */}
      {noPlayoffDate ? (
        <Callout tone="warn">
          This season has no playoff start date. Set one in “Playoff &amp; roster dates”
          above before configuring or seeding a bracket.
        </Callout>
      ) : (
        <p style={{ fontSize: 12.5, color: "#6b6257", margin: 0 }}>
          {d.playoffs_live
            ? `Playoffs are live — ${d.playoff_window?.from} → ${d.playoff_window?.to}.`
            : d.phase === "post"
              ? "The season is over."
              : `Playoffs begin ${d.season.playoff_starts_on}` +
                (d.days_until_playoffs != null && d.days_until_playoffs > 0
                  ? ` · ${d.days_until_playoffs} day${d.days_until_playoffs === 1 ? "" : "s"} away.`
                  : ".")}
          {d.roster_frozen ? " Rosters are frozen." : ""}
        </p>
      )}

      {/* ── format ─────────────────────────────────────────────────────── */}
      <div>
        <SectionLabel>Format</SectionLabel>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Participants">
            <Select
              value={kind}
              onChange={setKind}
              options={[{ value: "team", label: "Teams" }, { value: "player", label: "Players" }]}
            />
          </Field>
          <Field label="Qualifiers">
            <TextInput type="number" value={count} onChange={setCount} />
          </Field>
          <Field label="Seed from">
            <Select
              value={source}
              onChange={setSource}
              options={[
                { value: "regular", label: "Regular season" },
                { value: "full", label: "Full season" },
              ]}
            />
          </Field>
          <MiniButton onClick={() => setPending("configure")}>Save format</MiniButton>
        </div>
        <p style={{ fontSize: 11.5, color: MUTED, margin: "8px 0 0" }}>
          Single elimination by seed. A field that isn’t a power of two is padded with
          byes, which go to the top seeds. If fewer participants have scored than the
          qualifier count, the smaller real field is used.
        </p>
      </div>

      {/* ── the field ──────────────────────────────────────────────────── */}
      <div>
        <SectionLabel>
          {d.bracket ? `Field · ${d.bracket.qualifier_count} seeded, ${rounds} round(s)` : "Field"}
        </SectionLabel>

        {!d.bracket ? (
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 10px" }}>
            No bracket yet. Seeding snapshots the standings from the regular-season
            window{d.regular_window ? ` (${d.regular_window.from} → ${d.regular_window.to})` : ""} —
            re-seed if the field changes before the playoffs open.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 11.5, color: MUTED, margin: "0 0 8px" }}>
              Seeded {d.bracket.seeded_at.slice(0, 16).replace("T", " ")}
              {d.bracket.seeded_by ? ` by ${d.bracket.seeded_by}` : ""} from{" "}
              {d.bracket.seeding_window_from} → {d.bracket.seeding_window_to}.
            </p>
            <ol style={{ margin: "0 0 10px", padding: 0, listStyle: "none" }}>
              {d.seeds.map((s) => (
                <li
                  key={s.seed}
                  style={{
                    display: "flex", gap: 10, alignItems: "baseline",
                    padding: "4px 0", fontSize: 12.5,
                    borderTop: s.seed > 1 ? "1px solid var(--color-cream-line)" : "none",
                  }}
                >
                  <span className="font-mono" style={{ width: 28, color: "#94560a" }}>#{s.seed}</span>
                  <span style={{ fontWeight: 600 }}>{s.display_name}</span>
                  <span className="font-mono" style={{ marginLeft: "auto", color: MUTED }}>
                    {s.seed_points.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PrimaryButton
            onClick={() => setPending("seed")}
            disabled={noPlayoffDate || !d.config}
            title={
              noPlayoffDate ? "Set a playoff start date first"
                : !d.config ? "Save the format first"
                : undefined
            }
          >
            {d.bracket ? "Re-seed field" : "Lock playoff field"}
          </PrimaryButton>
          {d.bracket && (
            <>
              <MiniButton onClick={() => setPending("recompute")}>Refresh results</MiniButton>
              <MiniButton tone="danger" onClick={() => setPending("clear")}>Clear bracket</MiniButton>
            </>
          )}
        </div>
      </div>

      {/* ── the bracket ────────────────────────────────────────────────── */}
      {d.bracket && (
        <div>
          <SectionLabel>Bracket</SectionLabel>
          {byRound.map((ms, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div
                className="font-mono"
                style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}
              >
                {roundName(i + 1, rounds)} · {ms[0]?.round_starts_on} → {ms[0]?.round_ends_on}
              </div>
              {ms.map((m) => (
                <MatchupRow key={m.id} m={m} />
              ))}
            </div>
          ))}
          <p style={{ fontSize: 11.5, color: MUTED, margin: 0 }}>
            A matchup settles only after its round’s last day. Points shown are those
            earned inside that round’s window; ties go to the better seed. Results are
            derived from play — they cannot be edited here.
          </p>
        </div>
      )}

      <ReasonDialog
        open={pending !== null}
        busy={busy}
        title={
          pending === "configure" ? "Save playoff format"
            : pending === "seed" ? (d.bracket ? "Re-seed the playoff field" : "Lock the playoff field")
            : pending === "recompute" ? "Refresh bracket results"
            : "Clear the bracket"
        }
        description={
          pending === "configure"
            ? "Saves the format for this season. An already-seeded bracket keeps the settings it was seeded with until you re-seed."
            : pending === "seed"
              ? d.bracket
                ? "Replaces the existing bracket with a fresh snapshot of current regular-season standings. Any recorded results are discarded."
                : "Snapshots the qualifying field from regular-season standings and lays out the bracket."
              : pending === "recompute"
                ? "Re-settles every matchup from current scores. This can only apply results that real points and a closed round already decided."
                : "Discards the bracket, its seeds and all matchups. The format configuration is kept."
        }
        confirmLabel={pending === "clear" ? "Clear bracket" : "Confirm"}
        destructive={pending === "clear" || (pending === "seed" && !!d.bracket)}
        onCancel={() => setPending(null)}
        onConfirm={run}
      />
    </div>
  );
}

function MatchupRow({ m }: { m: Matchup }) {
  const decided = m.winner_participant_id != null;
  const side = (
    seed: number | null, name: string | null, points: number | null, id: string | null
  ) => {
    const won = decided && id != null && id === m.winner_participant_id;
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flex: 1, minWidth: 0 }}>
        <span className="font-mono" style={{ fontSize: 10.5, color: MUTED, width: 22 }}>
          {seed != null ? `#${seed}` : "—"}
        </span>
        <span
          style={{
            fontSize: 12.5, fontWeight: won ? 700 : 400,
            color: name ? "#141210" : MUTED,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {name ?? "TBD"}
        </span>
        <span className="font-mono" style={{ marginLeft: "auto", fontSize: 11.5, color: MUTED }}>
          {points != null ? points.toLocaleString() : "—"}
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex", gap: 14, alignItems: "center",
        padding: "6px 10px", marginBottom: 4, borderRadius: 6,
        border: "1px solid var(--color-cream-border)",
        background: decided ? "rgba(196,146,42,.06)" : "var(--color-warm-panel)",
      }}
    >
      {side(m.seed_a, m.name_a, m.points_a, m.participant_a)}
      <span className="font-mono" style={{ fontSize: 10, color: MUTED }}>vs</span>
      {side(m.seed_b, m.name_b, m.points_b, m.participant_b)}
      <span
        className="font-mono"
        style={{ fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: MUTED, width: 74, textAlign: "right" }}
      >
        {m.decided_reason ?? "open"}
      </span>
    </div>
  );
}

function roundName(round: number, total: number): string {
  if (round === total) return "Final";
  if (round === total - 1) return "Semifinals";
  if (round === total - 2) return "Quarterfinals";
  return `Round ${round}`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase",
        color: MUTED, marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="font-mono" style={{ fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: MUTED }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Callout({ children, tone }: { children: React.ReactNode; tone: "warn" }) {
  return (
    <div
      style={{
        fontSize: 12.5, padding: "8px 12px", borderRadius: 6,
        border: "1px solid rgba(196,146,42,.35)",
        background: "rgba(196,146,42,.10)", color: "#94560a",
      }}
    >
      {children}
    </div>
  );
}
