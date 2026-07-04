"use client";

// League Office — persistent left rail (236px, forest). BrandMark lockup, the
// nav tree, and the "staff only" footer. Tier 1 routes link; Tier 2/3 routes are
// shown but marked "soon" so the map is legible without dead links.

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandMark from "@/components/BrandMark";

type Item = { icon: string; label: string; href?: string; badge?: number };

const PRIMARY: Item[] = [
  { icon: "◈", label: "Dashboard", href: "/league-office" },
  { icon: "☰", label: "Subscribers", href: "/league-office/subscribers" },
  { icon: "⛨", label: "Teams", href: "/league-office/teams" },
  { icon: "▦", label: "Leagues & Conferences", href: "/league-office/leagues" },
  { icon: "◷", label: "Seasons", href: "/league-office/seasons" },
  { icon: "✎", label: "Puzzle & Hint Admin", href: "/league-office/puzzles" },
];
const TOOLS: Item[] = [
  { icon: "⇄", label: "Trading & Free Agency" },
  { icon: "⚑", label: "Announcements" },
  { icon: "☲", label: "Audit Log" },
  { icon: "⚠", label: "Disputes & Flags" },
  { icon: "⚙", label: "Staff & Permissions" },
];
const PLATFORM: Item[] = [{ icon: "⚙", label: "Settings" }];

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  if (href === "/league-office") return pathname === "/league-office";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavRow({ item, pathname }: { item: Item; pathname: string }) {
  if (!item.href)
    return (
      <span
        className="lo-nav-item"
        style={{ color: "rgba(248,245,240,.34)", cursor: "default" }}
        title="Coming in a later phase"
      >
        <span aria-hidden style={{ width: 16, textAlign: "center" }}>
          {item.icon}
        </span>
        <span>{item.label}</span>
        <span
          className="font-mono"
          style={{ marginLeft: "auto", fontSize: 8.5, letterSpacing: ".08em", color: "rgba(248,245,240,.28)" }}
        >
          SOON
        </span>
      </span>
    );
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href} className={`lo-nav-item${active ? " is-active" : ""}`}>
      <span aria-hidden style={{ width: 16, textAlign: "center" }}>
        {item.icon}
      </span>
      <span>{item.label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono"
      style={{
        fontSize: 9.5,
        letterSpacing: ".12em",
        color: "rgba(140,166,138,.9)",
        margin: "16px 12px 6px",
      }}
    >
      {children}
    </div>
  );
}

export default function Rail() {
  const pathname = usePathname() || "/league-office";
  return (
    <nav
      style={{
        width: 236,
        flex: "none",
        background: "var(--color-forest)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "18px 10px",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "100vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 14px" }}>
        <BrandMark framed size={20} />
        <div>
          <div className="font-serif" style={{ color: "#f8f5f0", fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
            League Office
          </div>
          <div
            className="font-mono"
            style={{ fontSize: 9.5, letterSpacing: ".1em", color: "var(--color-gold-light)", marginTop: 3 }}
          >
            COMMISSIONER CONSOLE
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {PRIMARY.map((it) => (
          <NavRow key={it.label} item={it} pathname={pathname} />
        ))}
        <SectionLabel>COMMISSIONER TOOLS</SectionLabel>
        {TOOLS.map((it) => (
          <NavRow key={it.label} item={it} pathname={pathname} />
        ))}
        <SectionLabel>PLATFORM</SectionLabel>
        {PLATFORM.map((it) => (
          <NavRow key={it.label} item={it} pathname={pathname} />
        ))}
      </div>

      <div
        className="font-mono"
        style={{ marginTop: "auto", padding: "16px 10px 0", fontSize: 10, lineHeight: 1.5, color: "rgba(140,166,138,.85)" }}
      >
        faraday-intelligence.ai
        <br />
        internal · staff only
      </div>
    </nav>
  );
}
