// ── Signal Room wiring (homepage tile + /signal-room route) ──────────────────
//
// Signal Room is its own app on its own domain (Vercel project
// faraday-signal-room, repo Mykemiller/Faraday-Signal-Room). This module is the
// one place the engine knows its address and asks whether it is up, so the Home
// tile, the storefront list and the /signal-room route cannot drift apart
// (same idea as src/lib/jw-url.ts).
//
// The tile used to carry a hardcoded "Live" tag. On 2026-11-10 the Signal Room
// page was serving "We couldn't load Signals right now" while this homepage
// still advertised it as Live. The tag is now earned: it is shown only when the
// Signal Room's own health endpoint says the feed is populated.
//
// Fail-soft contract (mirrors game-registry-server.ts): NEVER THROWS. Any
// failure — timeout, 404 before the endpoint ships, bad JSON — is "unknown",
// and unknown renders exactly like unhealthy: the tile still links, it just
// makes no claim.

export const SIGNAL_ROOM_ORIGIN = "https://faraday-signal-room.com";
export const SIGNAL_ROOM_URL = `${SIGNAL_ROOM_ORIGIN}/signal-room`;
export const SIGNAL_ROOM_HEALTH_URL = `${SIGNAL_ROOM_ORIGIN}/api/signal-room/health`;

/** How long a health answer is reused. Matches the Signal Room's own feed cache. */
export const SIGNAL_ROOM_HEALTH_TTL_SECONDS = 300;
const HEALTH_TIMEOUT_MS = 2500;

export interface SignalRoomHealth {
  ok: boolean;
  /** The Signal Room's own launch flag; false means it shows a Preview banner. */
  live: boolean;
  /** Signals fired in the rolling 24 hours. */
  last24h: number;
}

/** Anything we could not read is this. */
export const SIGNAL_ROOM_UNKNOWN: SignalRoomHealth = { ok: false, live: false, last24h: 0 };

/**
 * Validate the health body. Strict on purpose: a truthy-but-wrong payload
 * (an HTML error page parsed loosely, `"ok": "false"`) must not earn a "Live"
 * tag. Only a literal `true` counts.
 */
export function parseSignalRoomHealth(body: unknown): SignalRoomHealth {
  if (!body || typeof body !== "object") return SIGNAL_ROOM_UNKNOWN;
  const b = body as Record<string, unknown>;
  if (b.ok !== true) return SIGNAL_ROOM_UNKNOWN;
  const n = b.last24h;
  return {
    ok: true,
    live: b.live === true,
    last24h: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0,
  };
}

export interface SignalRoomTile {
  /** Status chip, or undefined to show none. */
  tag: string | undefined;
  /** One measured line under the blurb, or undefined to show none. */
  stat: string | undefined;
}

/**
 * What the Home tile may say. "Live" needs both a populated feed AND the
 * Signal Room's own launch flag. The count is shown only when it is a real,
 * non-zero number — never a placeholder.
 */
export function signalRoomTile(h: SignalRoomHealth): SignalRoomTile {
  if (!h.ok || !h.live) return { tag: undefined, stat: undefined };
  return {
    tag: "Live",
    stat:
      h.last24h > 0
        ? `${h.last24h.toLocaleString("en-US")} ${h.last24h === 1 ? "Signal" : "Signals"} in the last 24 hours`
        : undefined,
  };
}

/** Ask the Signal Room whether its feed is up. Never throws. */
export async function loadSignalRoomHealth(): Promise<SignalRoomHealth> {
  try {
    const r = await fetch(SIGNAL_ROOM_HEALTH_URL, {
      next: { revalidate: SIGNAL_ROOM_HEALTH_TTL_SECONDS },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!r.ok) return SIGNAL_ROOM_UNKNOWN; // 503 = unhealthy, 404 = not shipped yet
    return parseSignalRoomHealth(await r.json().catch(() => null));
  } catch {
    return SIGNAL_ROOM_UNKNOWN;
  }
}
