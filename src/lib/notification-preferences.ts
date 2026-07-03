// Daily Challenge notification preferences — single source of truth for the
// shape, defaults, category copy, and the send gate. Persisted on
// dc_subscribers.notification_preferences (jsonb, nullable — NULL means "use
// defaults"; migration 20260703000001). Read/written through /api/account and
// edited on /account/notifications.
//
// CONTRACT: the four category ids below are fixed — other services read/write
// against them. Do NOT rename.
//
// Any service that sends a daily-challenge alert (cron, worker, edge function —
// none exists yet; the OTP/ops mailers are unrelated) must call
// shouldSendNotification(prefs, category, channel) before EACH send: master off
// silences everything regardless of category flags; otherwise a send goes out
// only when both the category and that specific channel are enabled.

export const NOTIFICATION_CHANNELS = ["sms", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = [
  {
    id: "reminder_to_play",
    label: "Reminder to play",
    description: "Nudge me before today's challenge closes",
  },
  {
    id: "streak_at_risk",
    label: "Streak at risk",
    description: "Warn me when my streak is about to break",
  },
  {
    id: "teammate_completed",
    label: "Teammate completed challenge",
    description: "Tell me when a teammate finishes today's challenge",
  },
  {
    id: "leaderboard_movement",
    label: "Leaderboard movement",
    description: "Let me know when my rank changes",
  },
] as const;

export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORIES)[number]["id"];

export interface CategoryPreference {
  enabled: boolean;
  channels: Record<NotificationChannel, boolean>;
}

export interface NotificationPreferences {
  master_enabled: boolean;
  categories: Record<NotificationCategoryId, CategoryPreference>;
}

// Defaults for a subscriber with no stored preferences (NULL column).
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  master_enabled: true,
  categories: {
    reminder_to_play:     { enabled: true,  channels: { sms: false, email: true  } },
    streak_at_risk:       { enabled: true,  channels: { sms: true,  email: false } },
    teammate_completed:   { enabled: true,  channels: { sms: false, email: true  } },
    leaderboard_movement: { enabled: false, channels: { sms: false, email: false } },
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Coerce anything (NULL column, partial write, junk from an old client) into
// the full shape: unknown keys are dropped, missing/mistyped flags fall back to
// the defaults above. Always returns a fresh object — safe to mutate.
export function normalizeNotificationPreferences(raw: unknown): NotificationPreferences {
  const src = isRecord(raw) ? raw : {};
  const srcCats = isRecord(src.categories) ? src.categories : {};

  const categories = {} as NotificationPreferences["categories"];
  for (const { id } of NOTIFICATION_CATEGORIES) {
    const def = DEFAULT_NOTIFICATION_PREFERENCES.categories[id];
    const cat = isRecord(srcCats[id]) ? (srcCats[id] as Record<string, unknown>) : {};
    const ch = isRecord(cat.channels) ? (cat.channels as Record<string, unknown>) : {};
    categories[id] = {
      enabled: typeof cat.enabled === "boolean" ? cat.enabled : def.enabled,
      channels: {
        sms:   typeof ch.sms   === "boolean" ? ch.sms   : def.channels.sms,
        email: typeof ch.email === "boolean" ? ch.email : def.channels.email,
      },
    };
  }

  return {
    master_enabled:
      typeof src.master_enabled === "boolean"
        ? src.master_enabled
        : DEFAULT_NOTIFICATION_PREFERENCES.master_enabled,
    categories,
  };
}

// THE send gate. Every sender calls this per (subscriber, category, channel)
// immediately before sending. Master off wins over everything; per-category
// settings persist underneath so re-enabling master restores the user's choices.
export function shouldSendNotification(
  raw: unknown,
  category: NotificationCategoryId,
  channel: NotificationChannel
): boolean {
  const prefs = normalizeNotificationPreferences(raw);
  if (!prefs.master_enabled) return false;
  const cat = prefs.categories[category];
  return !!cat && cat.enabled && cat.channels[channel] === true;
}
