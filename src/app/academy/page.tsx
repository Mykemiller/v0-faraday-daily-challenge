import { redirect } from "next/navigation";

export const metadata = { title: "Faraday Academy" };

// The Faraday Academy lobby is live as its own app. /academy redirects there
// (307 — temporary, so we can later serve it natively or via a subdomain
// without a cached permanent redirect). The homepage Academy panel links here.
const ACADEMY_URL = "https://faraday-academy.vercel.app/academy";

export default function Page() {
  redirect(ACADEMY_URL);
}
