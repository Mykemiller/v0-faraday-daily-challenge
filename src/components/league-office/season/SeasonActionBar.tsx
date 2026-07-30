"use client";

// League Office — Season detail action bar (spec §2.3): Clone to new version ·
// Lock/Unlock season · Close season.
//
// All three are audited mutations, so each opens the mandatory-reason dialog.
// Locking is presented as reversible (it is — Unlock is right here), while
// closing is flagged destructive because it ends the season for players.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/league-office/actions";
import { ReasonDialog } from "./ReasonDialog";
import { MiniButton, PrimaryButton } from "./fields";

type Action = "clone" | "lock" | "unlock" | "close";

export function SeasonActionBar({
  seasonId,
  locked,
  status,
}: {
  seasonId: string;
  locked: boolean;
  status: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (reason: string) => {
    if (!action) return;
    setBusy(true);
    try {
      const res =
        action === "clone"
          ? await fetch(`/api/lo/seasons/${seasonId}/configs/clone`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason }),
            })
          : await fetch(`/api/lo/seasons/${seasonId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ op: action, reason }),
            });

      const j = await res.json().catch(() => ({}));
      toast(j?.message ?? (res.ok ? "Done." : "That did not work."));

      if (res.ok) {
        setAction(null);
        if (action === "clone" && j.configId)
          router.push(`/league-office/seasons/${seasonId}/config/${j.configId}`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const copy: Record<Action, { title: string; description: string; confirm: string; destructive?: boolean }> = {
    clone: {
      title: "Clone to new version",
      description:
        "Deep-copies the live (or latest) configuration into a new draft version — slate, theme mix and difficulty mix included. Nothing changes for players until that draft is promoted.",
      confirm: "Create draft",
    },
    lock: {
      title: "Lock season",
      description:
        "Freezes this season's configuration. Every config mutation is refused at the API layer, not just hidden in the UI. You can unlock it again at any time.",
      confirm: "Lock season",
    },
    unlock: {
      title: "Unlock season",
      description: "Allows configuration changes again.",
      confirm: "Unlock season",
    },
    close: {
      title: "Close season",
      description:
        "Marks the season closed. Players see it as finished. This does not delete any scores, memberships or history.",
      confirm: "Close season",
      destructive: true,
    },
  };

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <PrimaryButton
        onClick={() => setAction("clone")}
        disabled={busy || locked}
        title={locked ? "This season is locked." : undefined}
      >
        Clone to new version
      </PrimaryButton>

      <MiniButton onClick={() => setAction(locked ? "unlock" : "lock")} disabled={busy}>
        {locked ? "Unlock season" : "Lock season"}
      </MiniButton>

      {status !== "closed" ? (
        <MiniButton tone="danger" onClick={() => setAction("close")} disabled={busy}>
          Close season
        </MiniButton>
      ) : null}

      <ReasonDialog
        open={action !== null}
        busy={busy}
        title={action ? copy[action].title : ""}
        description={action ? copy[action].description : ""}
        confirmLabel={action ? copy[action].confirm : "Confirm"}
        destructive={action ? copy[action].destructive : false}
        onCancel={() => setAction(null)}
        onConfirm={run}
      />
    </div>
  );
}
