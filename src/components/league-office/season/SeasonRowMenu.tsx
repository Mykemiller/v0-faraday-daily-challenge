"use client";

// League Office — per-row action menu on the Seasons index (spec §2.1).
//
// Click-toggle dropdown with click-outside + Escape close, matching the DC
// header nav's behavior. "Clone to new version" is a real mutation, so it goes
// through the mandatory-reason dialog like every other audited write.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import { FAINT, INK } from "./fields";

export function SeasonRowMenu({
  seasonId,
  configId,
  locked,
}: {
  seasonId: string;
  configId: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const clone = async (reason: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lo/seasons/${seasonId}/configs/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "New draft created." : "Clone failed."));
      if (res.ok && j.configId) {
        setCloning(false);
        router.push(`/league-office/seasons/${seasonId}/config/${j.configId}`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const itemStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "7px 12px",
    fontSize: 12.5,
    color: INK,
    background: "none",
    border: "none",
    cursor: "pointer",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Season actions"
        style={{
          border: "1px solid var(--color-cream-border)",
          background: "#fff",
          borderRadius: 6,
          padding: "3px 8px",
          fontSize: 13,
          color: FAINT,
          cursor: "pointer",
          lineHeight: 1.2,
        }}
      >
        ⋯
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: "#fff",
            border: "1px solid var(--color-cream-border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(20,18,16,.14)",
            zIndex: 30,
            minWidth: 190,
            padding: "4px 0",
          }}
        >
          {configId ? (
            <Link href={`/league-office/seasons/${seasonId}/config/${configId}`} style={itemStyle} role="menuitem" onClick={() => setOpen(false)}>
              Edit config
            </Link>
          ) : (
            <span style={{ ...itemStyle, color: FAINT, cursor: "default" }}>No config yet</span>
          )}

          <button
            type="button"
            role="menuitem"
            style={{ ...itemStyle, color: locked ? FAINT : INK, cursor: locked ? "not-allowed" : "pointer" }}
            disabled={locked}
            title={locked ? "This season is locked." : undefined}
            onClick={() => { setOpen(false); setCloning(true); }}
          >
            Clone to new version
          </button>

          <Link href={`/league-office/seasons/new?copyFrom=${seasonId}`} style={itemStyle} role="menuitem" onClick={() => setOpen(false)}>
            Duplicate season
          </Link>

          <Link href={`/league-office/seasons/${seasonId}`} style={itemStyle} role="menuitem" onClick={() => setOpen(false)}>
            View history
          </Link>
        </div>
      ) : null}

      <ReasonDialog
        open={cloning}
        busy={busy}
        title="Clone to new version"
        description="Deep-copies this season's live (or latest) configuration into a new draft version. Nothing changes for players until that draft is promoted."
        confirmLabel="Create draft"
        onCancel={() => setCloning(false)}
        onConfirm={clone}
      />
    </div>
  );
}
