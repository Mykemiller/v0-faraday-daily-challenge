// League Office — Messages. The commissioner's 1:1 subscriber inbox (the other
// end of the "Message The Commissioner" dock). Reads/replies act as the resolved
// commissioner subscriber; staff is re-verified server-side on every API call.

import { requireStaff } from "@/lib/league-office/service";
import { PageHeading, PendingScreen } from "@/components/league-office/primitives";
import { LoMessages } from "@/components/league-office/LoMessages";

export default async function MessagesPage() {
  const staff = await requireStaff();
  if (!staff.ok) return <PendingScreen />;

  return (
    <>
      <PageHeading title="Messages" sub="Direct messages to and from subscribers" />
      <LoMessages />
    </>
  );
}
