// Faraday Academy — sitemap. Open lessons make this load-bearing for discovery.
// Built from the academy-public sitemap endpoint so it lists exactly the courses
// that are servable. No course codes, no domain codes.

import { getSitemap } from "@/lib/academy/api";
import { siteOrigin } from "@/lib/academy/origin";

// 300s ISR. Must be a static literal — Next analyses segment config without
// evaluating the module, so an imported constant is rejected at build time.
// Keep in step with ACADEMY_REVALIDATE_SECONDS in src/lib/academy/api.ts.
export const revalidate = 300;

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string,
  );
}

export async function GET(): Promise<Response> {
  const origin = siteOrigin();
  const result = await getSitemap();
  const courses = result.ok ? result.data.courses : [];

  const urls: string[] = [`  <url><loc>${origin}/academy</loc></url>`];
  for (const c of courses) {
    if (!c.slug) continue;
    const base = `${origin}/academy/${encodeURIComponent(c.slug)}`;
    const lastmod = c.updated_at ? `<lastmod>${xmlEscape(c.updated_at)}</lastmod>` : "";
    urls.push(`  <url><loc>${base}</loc>${lastmod}</url>`);
    urls.push(`  <url><loc>${base}/glossary</loc>${lastmod}</url>`);
    urls.push(`  <url><loc>${base}/quiz</loc>${lastmod}</url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
    },
  });
}
