// League Playoffs — player-facing banner copy, as a pure function.
//
// Lives here rather than inside PlayoffBanner.tsx so it is testable: Node's
// type-stripping test runner cannot load JSX. The component imports this and
// renders whatever it returns; `null` means render nothing at all.

export type PlayoffBannerState = {
  phase: "pre" | "regular" | "playoff" | "post";
  playoffs_live: boolean;
  playoff_starts_on: string | null;
  days_until_playoffs: number | null;
  roster_frozen: boolean;
  roster_freeze_on: string | null;
  days_until_roster_freeze: number | null;
};

export type BannerLine = { headline: string; detail: string; cta: string };

/** How many days out the roster freeze starts being worth announcing. Before
 *  this it would be noise on every visit for weeks. */
export const FREEZE_NOTICE_DAYS = 7;

/**
 * State → copy. Precedence is deliberate:
 *   1. Live playoffs outrank everything — it is the most consequential fact.
 *   2. Otherwise count down to the playoff opening, mentioning the roster
 *      freeze only when it is imminent or already in force.
 *   3. Otherwise, if rosters are frozen but playoffs have not opened (the gap
 *      between the two dates), the freeze is the live fact and leads.
 *   4. Nothing to say → null, so the caller renders no empty frame.
 */
export function bannerLine(s: PlayoffBannerState): BannerLine | null {
  if (s.playoffs_live) {
    return {
      headline: "Playoffs are live",
      detail: "Only points scored from here on count toward the bracket.",
      cta: "See the bracket",
    };
  }

  const dP = s.days_until_playoffs;
  if (dP != null && dP > 0) {
    const dF = s.days_until_roster_freeze;
    const freezeSoon = !s.roster_frozen && dF != null && dF >= 0 && dF <= FREEZE_NOTICE_DAYS;
    return {
      headline: `Playoffs start in ${dP} day${dP === 1 ? "" : "s"}`,
      detail: s.roster_frozen
        ? "Rosters are frozen — your teams are locked in."
        : freezeSoon
          ? `Rosters freeze in ${dF} day${dF === 1 ? "" : "s"}.`
          : "",
      cta: "Standings",
    };
  }

  if (s.roster_frozen) {
    return {
      headline: "Rosters are frozen for the playoffs",
      detail: "Your teams are locked in for the rest of the season.",
      cta: "Standings",
    };
  }

  return null;
}
