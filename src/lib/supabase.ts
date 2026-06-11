// Central Supabase endpoint config for the Faraday Daily Challenge client.
// Public URL — safe to ship in the bundle. All sensitive access goes through
// edge functions that run with the service role on the server side.

export const SUPABASE_URL = 'https://ycadmmngkdhvpcsrcuaq.supabase.co';
export const EDGE_FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

// LocalStorage keys for the session + email cache.
// Changing these names breaks existing signed-in users — tread carefully.
export const SESSION_STORAGE_KEY = 'dc_session';
export const EMAIL_STORAGE_KEY = 'dc_email';

export interface SubscriberState {
  email: string;
  playStreak: number;
  fullSetStreak: number;
  mwBalance: number;
  todayCompletions: Record<string, { score: number; completedAt: string }>;
}
