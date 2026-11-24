"use client";
// Faraday Academy — the shared Faraday masthead, configured for the player (FDY-459).
//
// A client wrapper for one reason: the player has no reader sign-in, so the
// masthead's sign-in slot must render nothing. Masthead only skips its default
// "Sign in" link (which points at a /sign-in route the player does not have) when
// `signIn` is truthy, and an empty fragment passed across the server→client
// boundary arrives empty. Created here, on the client, it stays a real element
// that renders no DOM — so no stray link and no extra flex gap.

import { Masthead } from "@/lib/faraday-masthead/ui/Masthead.tsx";

export default function AcademyMasthead({ homeHref }: { homeHref: string }) {
  return (
    <Masthead
      appName="Faraday Academy"
      homeHref={homeHref}
      skipTo="academy-main"
      signIn={<></>}
    />
  );
}
