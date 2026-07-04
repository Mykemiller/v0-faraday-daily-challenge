// League Office — pure presentational primitives (server-safe, no client hooks).
// The console's shared vocabulary: status chips (the four-color system), the
// page heading + double rule, game identity dots, and KPI cards.

import Link from "next/link";
import { toneStyle, statusToTone, type StatusTone, gameNeon } from "@/lib/league-office/constants";

export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone?: StatusTone;
}) {
  const t = tone ?? statusToTone(label);
  const st = toneStyle(t);
  return (
    <span
      className="font-mono"
      style={{
        display: "inline-block",
        fontSize: 9.5,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        padding: "3px 7px",
        borderRadius: 5,
        background: st.bg,
        color: st.fg,
        border: `1px solid ${st.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function PageHeading({
  title,
  sub,
}: {
  title: string;
  sub?: React.ReactNode;
}) {
  return (
    <header style={{ marginBottom: 22 }}>
      <h1 className="font-serif text-near-black" style={{ fontSize: 28, margin: 0, lineHeight: 1.1 }}>
        {title}
      </h1>
      <div className="double-rule" />
      {sub ? (
        <p className="text-warm-gray" style={{ fontSize: 13.5, margin: "12px 0 0", color: "#6b6257" }}>
          {sub}
        </p>
      ) : null}
    </header>
  );
}

export function GameDot({ game, size = 8 }: { game: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: gameNeon(game),
        flex: "none",
      }}
    />
  );
}

export function KpiCard({
  label,
  value,
  foot,
  href,
}: {
  label: string;
  value: string | number;
  foot?: string;
  href?: string;
}) {
  const inner = (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--color-cream-border)",
        borderRadius: 10,
        padding: "16px 18px",
        height: "100%",
      }}
    >
      <div
        className="font-mono"
        style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#8d8375" }}
      >
        {label}
      </div>
      <div className="font-serif text-near-black" style={{ fontSize: 26, marginTop: 6, lineHeight: 1 }}>
        {value}
      </div>
      {foot ? (
        <div style={{ fontSize: 12, color: "#6b6257", marginTop: 6 }}>{foot}</div>
      ) : null}
    </div>
  );
  if (href)
    return (
      <Link href={href} style={{ textDecoration: "none", display: "block" }}>
        {inner}
      </Link>
    );
  return inner;
}

/** Empty-state card — used wherever a live table is currently sparse/empty. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed var(--color-cream-edge)",
        borderRadius: 10,
        padding: "22px 18px",
        textAlign: "center",
        color: "#8d8375",
        fontSize: 13,
        background: "#fdfcfa",
      }}
    >
      {children}
    </div>
  );
}

/** First-paint placeholder shown by a page when the staff cookie isn't present
 *  yet (the client StaffGate overlays this and triggers a refresh). Kept quiet
 *  so it never flashes as an error. */
export function PendingScreen() {
  return (
    <div style={{ color: "#8d8375", fontSize: 13, padding: "8px 0" }}>Loading commissioner data…</div>
  );
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid var(--color-cream-border)",
        borderRadius: 10,
        padding: 18,
      }}
    >
      {title || action ? (
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 12 }}>
          {title ? (
            <h2 className="font-serif text-near-black" style={{ fontSize: 16, margin: 0 }}>
              {title}
            </h2>
          ) : null}
          {action ? <div style={{ marginLeft: "auto" }}>{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
