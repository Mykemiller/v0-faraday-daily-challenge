"use client";

// League Office — global header (60px). Search (scopes the current list via ?q),
// the persistent Season selector (?season), and the staff identity chip. Season
// scope is a URL param so every Server Component view can read it.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SeasonOpt = { id: string; name: string; status: string };

export default function HeaderBar({
  email,
  seasons,
}: {
  email: string | null;
  seasons: SeasonOpt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params?.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  const initials = (email ?? "· ·")
    .split("@")[0]
    .split(/[.\-_]/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "··";

  return (
    <header
      style={{
        height: 60,
        flex: "none",
        background: "#fff",
        borderBottom: "1px solid var(--color-cream-border)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 24px",
        position: "sticky",
        top: 0,
        zIndex: 5,
      }}
    >
      <input
        defaultValue={params?.get("q") ?? ""}
        onChange={(e) => setParam("q", e.target.value)}
        placeholder="Search subscribers, teams…"
        aria-label="Search"
        style={{
          width: 320,
          maxWidth: "40%",
          background: "var(--color-warm-panel)",
          border: "1px solid var(--color-cream-border)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          color: "#141210",
          outline: "none",
        }}
      />

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="font-mono"
          style={{ fontSize: 9.5, letterSpacing: ".12em", color: "#8d8375" }}
        >
          SEASON
        </span>
        <select
          value={params?.get("season") ?? ""}
          onChange={(e) => setParam("season", e.target.value)}
          aria-label="Season scope"
          style={{
            background: "var(--color-warm-panel)",
            border: "1px solid var(--color-cream-border)",
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 13,
            color: "#141210",
          }}
        >
          <option value="">All Seasons</option>
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.status !== "active" ? ` (${s.status})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span
          className="font-mono"
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "var(--color-forest)",
            color: "var(--color-gold-light)",
            display: "grid",
            placeItems: "center",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {initials}
        </span>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 12.5, color: "#141210", fontWeight: 600 }}>
            {email ?? "Not signed in"}
          </div>
          <div
            className="font-mono"
            style={{ fontSize: 9, letterSpacing: ".12em", color: "#8d8375" }}
          >
            COMMISSIONER
          </div>
        </div>
      </div>
    </header>
  );
}
