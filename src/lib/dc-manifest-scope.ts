// FDY-127 D6 (Myke's call — REVERTIBLE as one commit): give the root Daily Challenge manifest an
// explicit scope, so an install of the game on a non-DC host can no longer capture /predicts.
//
// Why it depends on the host: on the DC's canonical host the lobby lives at "/" (hosts.ts rewrites
// "/" → /challenge and canonicalDcPath maps the lobby to "/"), so any narrower scope there would push
// the lobby itself out of the installed app. On every other host (www.faraday-intelligence.ai, where
// /predicts lives, the Academy host, previews) DC pages are not canonical, so the scope is narrowed
// to the manifest's own start_url, "/daily-challenge", which excludes /predicts.
//
// Pure and dependency-free apart from hosts.ts, so node --test covers it.
import { isDcHost } from "./hosts.ts";

export const DC_START_URL = "/daily-challenge";

export function dcManifestScope(host: string | null | undefined): "/" | typeof DC_START_URL {
  return isDcHost(host) ? "/" : DC_START_URL;
}
