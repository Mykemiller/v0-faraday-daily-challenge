// Faraday Academy — the catalog.
//
// Server-rendered from the academy-public edge function with ISR at 300s under the
// "academy" tag. Replaces the 307 that used to send /academy to the standalone
// lobby app.

import type { Metadata } from "next";
import { getCatalog } from "@/lib/academy/api";
import CatalogBrowser from "@/components/academy/CatalogBrowser";
import { DoubleRule, FreeDuringBeta } from "@/components/academy/primitives";
import { Offline } from "@/components/academy/states";

// 300s ISR. Must be a static literal — Next analyses segment config without
// evaluating the module, so an imported constant is rejected at build time.
// Keep in step with ACADEMY_REVALIDATE_SECONDS in src/lib/academy/api.ts.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Faraday Academy — courses on the AI data center market",
  description:
    "Free during beta. Read how power, cooling, water, land, capital and policy actually decide where AI infrastructure gets built.",
  alternates: { canonical: "/academy" },
  openGraph: {
    title: "Faraday Academy",
    description:
      "Read how the AI data center market actually works — taught from primary sources.",
    url: "/academy",
    type: "website",
  },
};

export default async function AcademyCatalogPage() {
  const result = await getCatalog();

  if (!result.ok) return <Offline retryHref="/academy" />;
  const catalog = result.data;

  return (
    <main id="academy-main" className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-4xl font-bold" style={{ color: "var(--ac-text)" }}>
          The Academy
        </h1>
        <DoubleRule className="mt-3" />
        <p className="mt-4 max-w-2xl text-base" style={{ color: "var(--ac-muted)" }}>
          How the AI data center market actually works — power, cooling, water, land,
          capital and policy, taught from primary sources. Every lesson is open to read.
        </p>
        {catalog.beta.free ? (
          <p className="mt-4">
            <FreeDuringBeta />
          </p>
        ) : null}
      </div>

      <CatalogBrowser catalog={catalog} />
    </main>
  );
}
