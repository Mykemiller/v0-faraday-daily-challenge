// The Daily Challenge lobby (<DailyChallenge/>) renders its own full-screen
// header and navigation, so the challenge segment uses a pass-through layout.
export default function ChallengeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
