// League Office — shared shell for the whole /league-office tree. Server
// Component: resolves the staff context (best-effort on first paint, before the
// client gate has mirrored the cookie) to populate the header identity + season
// selector, renders the persistent rail + header, and gates the page body.
//
// Reading the cookie inside requireStaff() opts this segment into dynamic
// rendering — correct for live, per-request admin data.

import type { Metadata } from "next";
import Rail from "@/components/league-office/Rail";
import HeaderBar from "@/components/league-office/HeaderBar";
import StaffGate from "@/components/league-office/StaffGate";
import { Toaster } from "@/components/league-office/actions";
import { requireStaff } from "@/lib/league-office/service";
import { loadSeasons } from "@/lib/league-office/data";

export const metadata: Metadata = {
  title: "League Office — Commissioner Console",
  robots: { index: false, follow: false },
};

export default async function LeagueOfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireStaff();
  const email = staff.ok ? staff.email : null;
  const seasons = staff.ok
    ? (await loadSeasons(staff.s)).map((s) => ({ id: s.id, name: s.name, status: s.status }))
    : [];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-warm-white)" }}>
      <Rail />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <HeaderBar email={email} seasons={seasons} />
        <StaffGate>
          <main style={{ padding: "26px 30px", maxWidth: 1200, width: "100%" }}>{children}</main>
        </StaffGate>
        <Toaster />
      </div>
    </div>
  );
}
