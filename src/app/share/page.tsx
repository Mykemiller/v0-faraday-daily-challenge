import Link from "next/link";
import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Share / Invite · Faraday Daily Challenge" };

// More Faraday → Share / Invite stub. Share actions already exist in-product
// (team invite codes on the lobby/account, rank sharing on /leaderboard); this
// page will gather them in one place.

export default function SharePage() {
  return (
    <DcStubPage
      title="Share / Invite"
      blurb="Invite colleagues to the Daily Challenge and share your results — one page for every share action."
    >
      <p>
        Today you can already share from inside the product: invite teammates with your
        team code (lobby and <Link href="/account" className="underline hover:text-forest">Account</Link>),
        or share your rank from the <Link href="/leaderboard" className="underline hover:text-forest">leaderboard</Link>.
        A dedicated share hub lands here.
      </p>
    </DcStubPage>
  );
}
