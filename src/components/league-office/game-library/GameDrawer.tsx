"use client";

// League Office — per-game detail drawer.
//
// Read section (Phase 3): every catalog field, the season assignment list, and
// the recent lo_audit_log entries for this game's target_id.
// Write section (Phase 4): lifecycle transition, metadata edit, season
// assign/unassign — all through the ONE audited endpoint, never a direct write.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/league-office/primitives";
import { toast } from "@/components/league-office/actions";
import {
  LIFECYCLE_LABEL,
  LIFECYCLE_TONE,
  allowedTransitions,
  type LifecycleState,
} from "@/lib/league-office/game-library-logic";
import type { GameLibraryEntry, SeasonColumn } from "@/lib/league-office/game-library";
import type { AuditRow } from "@/lib/league-office/write";

export type DrawerEntry = GameLibraryEntry & {
  audit: AuditRow[];
  seasons: SeasonColumn[];
};

export function GameDrawer({
  entry,
  canWrite,
  onClose,
}: {
  entry: DrawerEntry;
  canWrite: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const g = entry.game;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${g.display_name} details`}
      style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(20,18,16,.32)", border: "none", cursor: "pointer" }}
      />
      <aside
        style={{
          position: "relative",
          width: "min(560px, 100%)",
          height: "100%",
          background: "#fdfcfa",
          borderLeft: "1px solid var(--color-cream-border)",
          overflowY: "auto",
          padding: "22px 24px 60px",
          boxShadow: "-8px 0 28px rgba(20,18,16,.14)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="font-serif text-near-black" style={{ fontSize: 22, margin: 0, lineHeight: 1.15 }}>
              {g.display_name}
            </h2>
            <div className="font-mono" style={{ fontSize: 11, color: "#9c9488", marginTop: 4 }}>
              {g.game_key}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <StatusChip label={LIFECYCLE_LABEL[g.lifecycle_state]} tone={LIFECYCLE_TONE[g.lifecycle_state]} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: "#8d8375", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </div>

        <div className="double-rule" style={{ margin: "14px 0 18px" }} />

        <Section title="Catalog">
          <Fields
            rows={[
              ["Display name", g.display_name],
              ["Game key", <Mono key="gk">{g.game_key}</Mono>],
              ["Runtime key", g.runtime_key ? <Mono key="rk">{g.runtime_key}</Mono> : <Muted key="rk">not set</Muted>],
              ["Short code", g.short_code ?? <Muted key="sc">—</Muted>],
              ["Public ID prefix", g.public_id_prefix ? <Mono key="pp">{g.public_id_prefix}</Mono> : <Muted key="pp">—</Muted>],
              ["Category", g.category ?? "—"],
              ["Description", g.description ?? <Muted key="d">—</Muted>],
              ["Default points", String(g.default_points)],
              ["Hints", g.supports_hints ? `yes · max ${g.max_hints}` : "no"],
              ["Difficulty", [g.min_difficulty, g.max_difficulty].filter(Boolean).join(" – ") || "—"],
              ["Sort order", String(g.sort_order)],
              ["Launched", g.launched_on ?? <Muted key="l">—</Muted>],
              ["Retired", g.retired_on ?? <Muted key="r">—</Muted>],
              ["Active / beta", `${g.is_active ? "active" : "inactive"} · ${g.is_beta ? "beta" : "not beta"}`],
              ["Puzzle bank", <Mono key="bd">{entry.bankDepth} rows</Mono>],
              ["Idea source", g.idea_source ?? <Muted key="is">—</Muted>],
              ["Notes", g.notes ?? <Muted key="n">—</Muted>],
            ]}
          />
          {g.runtime_key ? null : (
            <Note>
              No runtime key. The serving path keys games by this exact string — a game cannot go
              live without one.
            </Note>
          )}
          {g.short_code && g.public_id_prefix && g.short_code !== g.public_id_prefix ? (
            <Note>
              <strong>{g.short_code}</strong> (short code) and <strong>{g.public_id_prefix}</strong>{" "}
              (public ID prefix) are two different live systems. Neither is derived from the other —
              share links in the wild use the prefix.
            </Note>
          ) : null}
        </Section>

        <Section title="Season assignments">
          {entry.assignments.length === 0 ? (
            <Muted>Not assigned to any season.</Muted>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {entry.assignments.map((a) => (
                <div
                  key={a.seasonId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 10px",
                    border: "1px solid var(--color-cream-border)",
                    borderRadius: 7,
                    background: "#fff",
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ color: "#141210" }}>{a.seasonName}</span>
                  <span className="font-mono" style={{ fontSize: 10, color: "#9c9488" }}>
                    {a.configState}
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    <StatusChip label={a.enabled ? "enabled" : "disabled"} tone={a.enabled ? "green" : "gray"} />
                  </span>
                </div>
              ))}
            </div>
          )}
          <Note>
            Assignment is a relationship, not a lifecycle state — and it is{" "}
            <strong>advisory only</strong>. Toggling a game here does not change what subscribers
            are served today.
          </Note>
        </Section>

        {canWrite ? (
          <>
            <LifecycleForm entry={entry} />
            <MetadataForm entry={entry} />
            <AssignmentForm entry={entry} />
          </>
        ) : null}

        <Section title="Audit trail">
          {entry.audit.length === 0 ? (
            <Muted>No recorded changes for this game.</Muted>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {entry.audit.map((a) => (
                <div key={a.id} style={{ fontSize: 12, borderLeft: "2px solid var(--color-cream-edge)", paddingLeft: 10 }}>
                  <div className="font-mono" style={{ fontSize: 10.5, color: "#9c9488" }}>
                    {a.at?.slice(0, 16).replace("T", " ")} · {a.staff_email}
                  </div>
                  <div style={{ color: "#141210", marginTop: 2 }}>
                    <span className="font-mono" style={{ fontSize: 11 }}>{a.action}</span>
                  </div>
                  {a.reason ? <div style={{ color: "#6b6257", marginTop: 2 }}>{a.reason}</div> : null}
                </div>
              ))}
            </div>
          )}
        </Section>
      </aside>
    </div>
  );
}

// ── write forms (Phase 4) ────────────────────────────────────────────────────

function LifecycleForm({ entry }: { entry: DrawerEntry }) {
  const from = entry.game.lifecycle_state;
  const options = allowedTransitions(from);
  const [to, setTo] = useState<LifecycleState | "">("");
  const [reason, setReason] = useState("");
  const { submit, busy, err } = useAction();

  if (options.length === 0)
    return (
      <Section title="Lifecycle">
        <Muted>No transitions available from {LIFECYCLE_LABEL[from]}.</Muted>
      </Section>
    );

  return (
    <Section title="Lifecycle">
      <Row>
        <Select value={to} onChange={setTo} placeholder="Move to…">
          {options.map((o) => (
            <option key={o} value={o}>
              {LIFECYCLE_LABEL[from]} → {LIFECYCLE_LABEL[o]}
            </option>
          ))}
        </Select>
      </Row>
      <Row>
        <Input value={reason} onChange={setReason} placeholder="Reason (required)" />
      </Row>
      {err ? <ErrText>{err}</ErrText> : null}
      <Submit
        disabled={!to || !reason.trim() || busy}
        busy={busy}
        label="Change lifecycle"
        onClick={() =>
          submit({ action: "game.lifecycle_change", gameId: entry.game.id, lifecycleTo: to, reason })
        }
      />
    </Section>
  );
}

function MetadataForm({ entry }: { entry: DrawerEntry }) {
  const g = entry.game;
  const live = g.lifecycle_state === "live";
  const [displayName, setDisplayName] = useState(g.display_name);
  const [category, setCategory] = useState(g.category ?? "");
  const [description, setDescription] = useState(g.description ?? "");
  const [points, setPoints] = useState(String(g.default_points));
  const [maxHints, setMaxHints] = useState(String(g.max_hints));
  const [sortOrder, setSortOrder] = useState(String(g.sort_order));
  const [runtimeKey, setRuntimeKey] = useState(g.runtime_key ?? "");
  const [reason, setReason] = useState("");
  const { submit, busy, err } = useAction();

  return (
    <Section title="Edit catalog">
      <Row><Labeled label="Display name"><Input value={displayName} onChange={setDisplayName} placeholder="Display name" /></Labeled></Row>
      <Row><Labeled label="Category"><Input value={category} onChange={setCategory} placeholder="Category" /></Labeled></Row>
      <Row><Labeled label="Description"><Input value={description} onChange={setDescription} placeholder="Description" /></Labeled></Row>
      <Row>
        <Labeled label="Default points"><Input value={points} onChange={setPoints} placeholder="Default points" /></Labeled>
        <Labeled label="Max hints"><Input value={maxHints} onChange={setMaxHints} placeholder="Max hints" /></Labeled>
        <Labeled label="Sort order"><Input value={sortOrder} onChange={setSortOrder} placeholder="Sort order" /></Labeled>
      </Row>
      <Row>
        <Labeled label={live ? "Runtime key (frozen)" : "Runtime key"}>
          <Input
            value={live ? g.runtime_key ?? "" : runtimeKey}
            onChange={setRuntimeKey}
            placeholder="Runtime key"
            disabled={live}
          />
        </Labeled>
      </Row>
      {live ? (
        <Note>
          <code>game_key</code> and <code>runtime_key</code> are frozen while this game is live —
          the runtime key is what the serving path joins on.
        </Note>
      ) : null}
      <Row><Input value={reason} onChange={setReason} placeholder="Reason (required)" /></Row>
      {err ? <ErrText>{err}</ErrText> : null}
      <Submit
        disabled={!reason.trim() || busy}
        busy={busy}
        label="Save changes"
        onClick={() =>
          submit({
            action: "game.update",
            gameId: g.id,
            reason,
            patch: {
              display_name: displayName,
              category,
              description,
              default_points: points,
              max_hints: maxHints,
              sort_order: sortOrder,
              ...(live ? {} : { runtime_key: runtimeKey }),
            },
          })
        }
      />
    </Section>
  );
}

function AssignmentForm({ entry }: { entry: DrawerEntry }) {
  const assignable = entry.seasons.filter((s) => !s.readOnly);
  const [seasonId, setSeasonId] = useState("");
  const [reason, setReason] = useState("");
  const { submit, busy, err } = useAction();

  const target = entry.seasons.find((s) => s.seasonId === seasonId) ?? null;
  const already = entry.assignments.some((a) => a.seasonId === seasonId);
  const eligible = entry.game.lifecycle_state === "live" || entry.game.lifecycle_state === "in_test";

  if (!eligible)
    return (
      <Section title="Season assignment">
        <Muted>
          Only live or in-test games may be assigned to a season. This is enforced by a database
          trigger, not just here.
        </Muted>
      </Section>
    );

  return (
    <Section title="Season assignment">
      {assignable.length === 0 ? (
        <Muted>No editable seasons — every season is closed, locked, or superseded.</Muted>
      ) : (
        <>
          <Row>
            <Select value={seasonId} onChange={setSeasonId} placeholder="Season…">
              {assignable.map((s) => (
                <option key={s.seasonId} value={s.seasonId}>
                  {s.name} ({s.configState})
                </option>
              ))}
            </Select>
          </Row>
          {target?.configState === "active" ? (
            <Note>
              This season is live — the change lands as a <strong>new configuration version</strong>{" "}
              and supersedes the current one.
            </Note>
          ) : null}
          <Row><Input value={reason} onChange={setReason} placeholder="Reason (required)" /></Row>
          {err ? <ErrText>{err}</ErrText> : null}
          <Submit
            disabled={!seasonId || !reason.trim() || busy}
            busy={busy}
            label={already ? "Unassign from season" : "Assign to season"}
            onClick={() =>
              submit({
                action: already ? "game.season_unassign" : "game.season_assign",
                gameId: entry.game.id,
                seasonId,
                reason,
              })
            }
          />
        </>
      )}
    </Section>
  );
}

// ── shared form plumbing ─────────────────────────────────────────────────────

function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/league-office/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setErr(json?.message ?? "That change could not be saved.");
        return;
      }
      toast(json.message ?? "Saved — logged to Audit Log.");
      router.refresh();
    } catch {
      setErr("Network error — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }
  return { submit, busy, err };
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 24 }}>
    <h3
      className="font-mono"
      style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "#8d8375", margin: "0 0 10px" }}
    >
      {title}
    </h3>
    {children}
  </section>
);

const Fields = ({ rows }: { rows: [string, React.ReactNode][] }) => (
  <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "132px 1fr", rowGap: 7, columnGap: 12, fontSize: 12.5 }}>
    {rows.map(([k, v], i) => (
      <div key={`${k}-${i}`} style={{ display: "contents" }}>
        <dt style={{ color: "#8d8375" }}>{k}</dt>
        <dd style={{ margin: 0, color: "#141210", wordBreak: "break-word" }}>{v}</dd>
      </div>
    ))}
  </dl>
);

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono" style={{ fontSize: 11.5 }}>{children}</span>
);
const Muted = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "#9c9488", fontSize: 12.5 }}>{children}</span>
);
const ErrText = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: "#9c3b2e", fontSize: 12, margin: "0 0 8px" }}>{children}</p>
);
const Note = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 11.5, color: "#6b6257", marginTop: 10, lineHeight: 1.5 }}>{children}</p>
);
const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>{children}</div>
);

/** A placeholder disappears the moment a field is populated — and every field in
 *  the edit form loads pre-populated, so placeholders alone would leave a column
 *  of unlabelled boxes. */
const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ flex: 1, minWidth: 0, display: "block" }}>
    <span
      className="font-mono"
      style={{
        display: "block",
        fontSize: 9.5,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: "#8d8375",
        marginBottom: 3,
      }}
    >
      {label}
    </span>
    {children}
  </label>
);

const FIELD: React.CSSProperties = {
  flex: 1,
  // An <input> inside the <label> wrapper is not a flex item, so it keeps its
  // default intrinsic width and refuses to shrink — three of them in one Row
  // overflow the drawer. width:100% + border-box makes it track its column.
  width: "100%",
  boxSizing: "border-box",
  minWidth: 0,
  fontSize: 12.5,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--color-cream-border)",
  background: "#fff",
  color: "#141210",
  font: "inherit",
};

function Input({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      disabled={disabled}
      style={{ ...FIELD, fontSize: 12.5, opacity: disabled ? 0.55 : 1 }}
    />
  );
}

function Select<T extends string>({
  value,
  onChange,
  placeholder,
  children,
}: {
  value: T | "";
  onChange: (v: T) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={placeholder}
      style={{ ...FIELD, fontSize: 12.5 }}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}

function Submit({
  label,
  onClick,
  disabled,
  busy,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12.5,
        padding: "7px 13px",
        borderRadius: 7,
        border: "1px solid var(--color-forest)",
        background: disabled ? "var(--color-warm-panel)" : "var(--color-forest)",
        color: disabled ? "#9c9488" : "#f8f5f0",
        cursor: disabled ? "not-allowed" : "pointer",
        font: "inherit",
      }}
    >
      {busy ? "Saving…" : label}
    </button>
  );
}
