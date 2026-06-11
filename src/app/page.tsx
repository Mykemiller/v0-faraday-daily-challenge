import { redirect } from 'next/navigation';

// The rebranded Daily Challenge lobby is the home experience and lives at
// /challenge (rendered by <DailyChallenge/>). Root redirects there so the
// daily-challenge domain lands on the canonical, rebranded lobby.
export default function Home() {
  redirect('/challenge');
}
