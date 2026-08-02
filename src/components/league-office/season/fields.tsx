"use client";

// League Office — Season Config form primitives.
//
// Brand system, matched to the existing console: IBM Plex Serif section
// headings, Plex Sans UI, Plex Mono for codes/percentages (right-aligned per
// spec §6), Gold #C4922A for the active/primary affordance, thin cream rules.
// No component library — these mirror the hand-rolled style of primitives.tsx.

import { DAY_LABELS, ALL_DAYS, isHundred, round2 } from "@/lib/league-office/season-config-logic";

export const GOLD = "#c4922a";
export const FOREST = "#1c3424";
export const INK = "#141210";
export const MUTED = "#6b6257";
export const FAINT = "#8d8375";

// ── layout ───────────────────────────────────────────────────────────────────

export function Section({
  id,
  title,
  blurb,
  action,
  children,
}: {
  id: string;
  title: string;
  blurb?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        background: "#fff",
        border: "1px solid var(--color-cream-border)",
        borderRadius: 10,
        padding: 20,
        marginBottom: 16,
        scrollMarginTop: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: blurb ? 4 : 14 }}>
        <h2 className="font-serif" style={{ fontSize: 17, margin: 0, color: INK }}>
          {title}
        </h2>
        {action ? <div style={{ marginLeft: "auto" }}>{action}</div> : null}
      </div>
      {blurb ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>{blurb}</p>
      ) : null}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  width,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <label style={{ display: "block", minWidth: 0, width }}>
      <span
        className="font-mono"
        style={{
          display: "block",
          fontSize: 9.5,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: FAINT,
          marginBottom: 5,
        }}
      >
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 11.5, color: FAINT, marginTop: 4, lineHeight: 1.45 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Grid({ cols = 2, children }: { cols?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${cols >= 3 ? 170 : 220}px, 1fr))`,
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

// ── inputs ───────────────────────────────────────────────────────────────────

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

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
  mono?: boolean;
}) {
  return (
    <input
      className={mono ? "font-mono" : undefined}
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "auto" }}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  disabled,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <textarea
      className={mono ? "font-mono" : undefined}
      rows={rows}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, opacity: disabled ? 0.55 : 1 }}
    />
  );
}

/** Numbers are Mono + right-aligned (spec §6). */
export function NumberInput({
  value,
  onChange,
  disabled,
  min,
  max,
  step,
  suffix,
  placeholder,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        className="font-mono"
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        disabled={disabled}
        min={min}
        max={max}
        step={step ?? 1}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ ...inputStyle, textAlign: "right", opacity: disabled ? 0.55 : 1 }}
      />
      {suffix ? <span className="font-mono" style={{ fontSize: 11.5, color: FAINT }}>{suffix}</span> : null}
    </span>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 10,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  const btn: React.CSSProperties = {
    width: 30,
    height: 30,
    border: "1px solid var(--color-cream-border)",
    background: "#fff",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 15,
    color: INK,
    lineHeight: 1,
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" style={btn} disabled={disabled || value <= min} onClick={() => step(-1)} aria-label="Decrease">
        −
      </button>
      <span className="font-mono" style={{ fontSize: 15, minWidth: 26, textAlign: "center", color: INK }}>
        {value}
      </span>
      <button type="button" style={btn} disabled={disabled || value >= max} onClick={() => step(1)} aria-label="Increase">
        +
      </button>
    </span>
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "none",
        border: "none",
        padding: "5px 0",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        textAlign: "left",
        width: "100%",
      }}
    >
      <span
        style={{
          width: 34,
          height: 19,
          borderRadius: 999,
          background: checked ? GOLD : "#d9d2c6",
          position: "relative",
          flex: "none",
          transition: "background .15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 17 : 2,
            width: 15,
            height: 15,
            borderRadius: "50%",
            background: "#fff",
            transition: "left .15s",
          }}
        />
      </span>
      <span style={{ fontSize: 13, color: INK }}>{label}</span>
    </button>
  );
}

/** Seven toggle pills, ISO Mon..Sun (spec §2.4 Section C). */
export function DayMask({
  value,
  onChange,
  disabled,
}: {
  value: number[] | null;
  onChange: (v: number[]) => void;
  disabled?: boolean;
}) {
  const active = new Set(value ?? ALL_DAYS);
  const toggle = (d: number) => {
    const next = new Set(active);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <span style={{ display: "inline-flex", gap: 3, flexWrap: "wrap" }}>
      {ALL_DAYS.map((d) => {
        const on = active.has(d);
        return (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => toggle(d)}
            aria-pressed={on}
            className="font-mono"
            style={{
              fontSize: 9.5,
              letterSpacing: ".04em",
              padding: "3px 5px",
              borderRadius: 4,
              border: `1px solid ${on ? GOLD : "var(--color-cream-border)"}`,
              background: on ? "rgba(196,146,42,.14)" : "#fff",
              color: on ? "#94560a" : FAINT,
              cursor: disabled ? "not-allowed" : "pointer",
              minWidth: 26,
            }}
            title={DAY_LABELS[d - 1]}
          >
            {DAY_LABELS[d - 1][0]}
          </button>
        );
      })}
    </span>
  );
}

// ── the 100% total bar (Sections D + E) ──────────────────────────────────────

/** Pinned at the top of an allocation section: green at exactly 100, amber
 *  otherwise, with the Normalize action alongside. */
export function TotalBar({
  total,
  onNormalize,
  onEven,
  extra,
  disabled,
}: {
  total: number;
  onNormalize?: () => void;
  onEven?: () => void;
  extra?: React.ReactNode;
  disabled?: boolean;
}) {
  const good = isHundred(total);
  const tone = good
    ? { bg: "rgba(79,107,77,.12)", fg: "#4f6b4d", border: "rgba(79,107,77,.30)" }
    : { bg: "rgba(148,86,10,.12)", fg: "#94560a", border: "rgba(148,86,10,.30)" };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "9px 12px",
        borderRadius: 8,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        marginBottom: 14,
      }}
    >
      <span className="font-mono" style={{ fontSize: 12.5, color: tone.fg, fontWeight: 600 }}>
        {round2(total)}%
      </span>
      <span style={{ fontSize: 12, color: tone.fg }}>
        {good ? "Allocation totals 100%" : "Allocation must total 100%"}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {extra}
        {onEven ? (
          <MiniButton onClick={onEven} disabled={disabled}>
            Even split
          </MiniButton>
        ) : null}
        {onNormalize ? (
          <MiniButton onClick={onNormalize} disabled={disabled || good}>
            Normalize to 100%
          </MiniButton>
        ) : null}
      </span>
    </div>
  );
}

/** Percent slider + Mono numeric, the shared row control for both mixes. */
export function PercentControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 80, accentColor: GOLD, cursor: disabled ? "not-allowed" : "pointer" }}
        aria-label="Target percent"
      />
      <input
        className="font-mono"
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        style={{ ...inputStyle, width: 74, textAlign: "right", padding: "5px 7px", fontSize: 12.5 }}
        aria-label="Target percent value"
      />
      <span className="font-mono" style={{ fontSize: 11, color: FAINT }}>
        %
      </span>
    </span>
  );
}

// ── buttons ──────────────────────────────────────────────────────────────────

export function MiniButton({
  children,
  onClick,
  disabled,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "gold" | "danger";
  title?: string;
}) {
  const palette =
    tone === "gold"
      ? { bg: GOLD, fg: "#fff", border: GOLD }
      : tone === "danger"
        ? { bg: "#fff", fg: "#9c3b2e", border: "rgba(156,59,46,.35)" }
        : { bg: "#fff", fg: INK, border: "var(--color-cream-border)" };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-mono"
      style={{
        fontSize: 10,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        padding: "6px 10px",
        borderRadius: 6,
        border: `1px solid ${palette.border}`,
        background: palette.bg,
        color: palette.fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="font-mono"
      style={{
        fontSize: 10.5,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "9px 16px",
        borderRadius: 7,
        border: `1px solid ${GOLD}`,
        background: disabled ? "rgba(196,146,42,.35)" : GOLD,
        color: "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

// ── callouts ─────────────────────────────────────────────────────────────────

export function Callout({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger" | "locked";
  children: React.ReactNode;
}) {
  const palette = {
    info: { bg: "rgba(28,52,36,.05)", border: "rgba(28,52,36,.18)", fg: "#2f4636" },
    warning: { bg: "rgba(148,86,10,.10)", border: "rgba(148,86,10,.28)", fg: "#7c4708" },
    danger: { bg: "rgba(156,59,46,.10)", border: "rgba(156,59,46,.30)", fg: "#8a3428" },
    locked: { bg: "rgba(107,98,87,.10)", border: "rgba(107,98,87,.26)", fg: "#5b5349" },
  }[tone];

  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: "10px 13px",
        fontSize: 12.5,
        lineHeight: 1.55,
        color: palette.fg,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

/** Inline sparkline for the difficulty curve preview (Section E). */
export function Sparkline({ points, width = 120, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (width - 2) + 1;
      const y = height - 3 - p * (height - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block" }}>
      <path d={d} fill="none" stroke={GOLD} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
