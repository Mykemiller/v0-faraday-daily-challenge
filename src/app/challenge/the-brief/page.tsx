import { redirect } from 'next/navigation';

// Per-game routes are retired in favor of the unified lobby at /challenge.
// Kept as redirects so existing deep links (and the /rackl-style vercel.json
// redirects that target them) never 404.
export default function Page() {
  redirect('/challenge');
}
