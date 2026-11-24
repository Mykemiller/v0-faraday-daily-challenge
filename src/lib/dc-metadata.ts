// CC-DC-CANONICAL-DOMAIN-1.0 Phase 2 — DC page metadata, canonical by default.
//
// Every Daily Challenge page declares its canonical URL on the DC domain, so a
// crawler (or an unfurl, or a reader who arrived on a stale brand-host link that
// was 308'd here) is told exactly one address for the page.
//
// `metadataBase` is pinned to DC_CANONICAL_ORIGIN rather than derived from the
// request, because one deployment answers for three brands: reading the Host
// header in generateMetadata would both opt the route out of static rendering
// and make the canonical depend on which host happened to answer. A canonical
// names the PREFERRED url regardless of who served it — that is the whole point
// of the tag.
//
// Most DC pages are client components ("use client"), which cannot export
// metadata. Those carry a three-line segment layout.tsx that calls this helper;
// the canonical is set per PAGE, never on a layout that has children at other
// paths, since a layout-level canonical would wrongly claim the parent's URL for
// every child route.

import type { Metadata } from "next";
import { DC_CANONICAL_ORIGIN, dcCanonicalUrl } from "@/lib/hosts";

/**
 * Metadata for a Daily Challenge page.
 *
 * @param path   the page's internal app path, e.g. "/challenge/hints". Lobby
 *               aliases are normalised by dcCanonicalUrl ("/challenge" → "/").
 * @param extra  page metadata (title, description, …) merged over the defaults.
 */
export function dcPageMetadata(path: string, extra?: Metadata): Metadata {
  return {
    metadataBase: new URL(DC_CANONICAL_ORIGIN),
    alternates: { canonical: dcCanonicalUrl(path) },
    ...extra,
  };
}
