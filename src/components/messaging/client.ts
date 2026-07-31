// Shared client-side types + helpers for the messaging UI (CC-DC-MESSAGING-1.0).

import { useSyncExternalStore } from "react";
import { SESSION_STORAGE_KEY, HANDLE_STORAGE_KEY } from "@/lib/supabase";

// localStorage never notifies same-tab, so subscription is a no-op; the store
// hooks below exist to read browser state without setState-in-effect (and with
// a null server snapshot, so SSR hydrates as signed-out then corrects).
const noSubscribe = () => () => {};

/** False during SSR/hydration, true after — gates the sign-in prompt flash. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export function useDcToken(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => { try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; } },
    () => null
  );
}

export function useDcHandle(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      try {
        return (
          localStorage.getItem(HANDLE_STORAGE_KEY) ??
          localStorage.getItem("dc_email")?.split("@")[0] ??
          null
        );
      } catch {
        return null;
      }
    },
    () => null
  );
}

export interface ThreadRow {
  conversation_id: string;
  kind: "team_broadcast" | "direct";
  title: string;
  counterpart_handle: string | null;
  team_id: string | null;
  last_message_at: string | null;
  preview: string | null;
  unread: number;
  muted: boolean;
}

export interface ThreadMessage {
  id: string;
  author_id: string;
  author_handle: string;
  body: string;
  created_at: string;
  is_mine: boolean;
  can_delete: boolean;
}

export interface ThreadDetail {
  conversation_id: string;
  kind: "team_broadcast" | "direct";
  messages: ThreadMessage[];
  viewer_state: { last_read_at: string | null; muted: boolean };
  counterpart?: { subscriber_id: string; handle: string; is_blocked_by_me: boolean };
  is_captain?: boolean;
  remaining_today?: number | null;
  team?: { id: string; name: string | null } | null;
}

export interface DirectoryHit {
  subscriber_id: string;
  handle: string;
}

/** Compact relative time for thread rows: now · 5m · 3h · 2d · Jul 12. */
export function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Time-of-day (+ date when not today) for message rows. */
export function msgTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

export function isUnread(m: ThreadMessage, lastReadAt: string | null): boolean {
  if (m.is_mine) return false;
  if (!lastReadAt) return true;
  return Date.parse(m.created_at) > Date.parse(lastReadAt);
}

export async function fetchUnreadTotal(token: string): Promise<number> {
  try {
    const r = await fetch(`/api/messages?token=${encodeURIComponent(token)}&scope=unread`);
    if (!r.ok) return 0;
    const j = await r.json();
    return typeof j.total === "number" ? j.total : 0;
  } catch {
    return 0;
  }
}
