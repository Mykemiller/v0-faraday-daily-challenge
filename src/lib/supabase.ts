// Central Supabase endpoint config for the Faraday Daily Challenge client.
// Public URL — safe to ship in the bundle. All sensitive access goes through
// edge functions that run with the service role on the server side.

export const SUPABASE_URL = 'https://ycadmmngkdhvpcsrcuaq.supabase.co';
export const EDGE_FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

// LocalStorage keys for the session + email cache.
// Changing these names breaks existing signed-in users — tread carefully.
export const SESSION_STORAGE_KEY = 'dc_session';
export const EMAIL_STORAGE_KEY = 'dc_email';
// Canonical leaderboard handle, mirrored client-side at /auth (verify-magic-link
// returns it). Rendered on every puzzle; falls back to the email local-part.
export const HANDLE_STORAGE_KEY = 'dc_handle';
// Soft opt-out ("leave the game") mirror. Canonical value is dc_subscribers.active
// (set via /api/account). This client mirror lets the app suppress streak accrual
// and hide the player from the in-app team board without an edge-function deploy.
export const OPTED_OUT_STORAGE_KEY = 'dc_opted_out';
// Subscriber UUID — stored after OTP auth to support team membership lookups
export const SUBSCRIBER_ID_KEY = 'dc_subscriber_id';

export interface SubscriberState {
  email: string;
  playStreak: number;
  fullSetStreak: number;
  todayCompletions: Record<string, { score: number; completedAt: string }>;
}
