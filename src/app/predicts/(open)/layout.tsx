import { connection } from "next/server";
import PredictsFrame from "../PredictsFrame";

// FDY-433 (ADM-1.7h): /predicts/preferences stays outside the Faraday beta access gate in every gate
// mode. Every digest links here (manage delivery, unsubscribe), and the page authenticates with the
// subscriber's own ?t= link token, so it must keep working for someone the gate would turn away.
// Do NOT import src/lib/faradayGate or the faraday-gate package here (src/lib/predicts-gate-carveout.test.ts
// fails if you do). It renders the same shell as the gated pages, without a verified email.
// connection() keeps it rendered per request, as it was when the gate sat in the shared layout.
export default async function PredictsOpenLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <PredictsFrame email={null}>{children}</PredictsFrame>;
}
