import Link from "next/link";

// Shown inside the Predicts shell (so the disclaimer and release line stay).
export default function PredictsNotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-[28px] font-bold text-near-black">That forecast isn’t here</h1>
      <p className="mt-2 font-sans text-[16px] text-near-black/80">The link may be mistyped, or the call may have been withdrawn.</p>
      <Link href="/predicts" className="mt-4 inline-flex min-h-[44px] items-center font-sans text-[15px] font-medium text-forest underline">
        Back to the open board
      </Link>
    </main>
  );
}
