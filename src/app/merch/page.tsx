import Image from "next/image";
import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Faraday Merchandise" };

// More Faraday → Faraday Merchandise. The page stays a coming-soon stub; the
// grid below is presentational only — no cart, no pricing, no checkout.
// Adding a fourth item is one object in PRODUCTS: drop its <slug>.webp and
// <slug>.jpg into /public/merch (1200x1200, trimmed and centered on white) and
// append here. No CMS, no Airtable, no data layer.

type Product = {
  /** Basename of the image pair in /public/merch. */
  slug: string;
  name: string;
  /** Image alt text. Describes the garment itself, never the brand or mark. */
  alt: string;
};

const PRODUCTS: Product[] = [
  {
    slug: "faraday-cap",
    name: "Faraday Cap",
    alt: "Stone six-panel baseball cap with a curved brim and a round embroidered patch on the front panel.",
  },
  {
    slug: "faraday-academy-polo",
    name: "Faraday Academy Polo",
    alt: "Black short-sleeve performance polo with a ribbed collar, three-button placket and a rectangular embroidered patch on the left chest.",
  },
  {
    slug: "faraday-academy-quarter-zip",
    name: "Faraday Academy Quarter-Zip",
    alt: "Black long-sleeve quarter-zip pullover with a stand collar and a rectangular embroidered patch on the left chest.",
  },
];

export default function MerchPage() {
  return (
    <DcStubPage
      title="Faraday Merchandise"
      blurb="Wear the Readiness. Faraday merch is in the works."
    >
      {/* mb-6, not mt-* on the disclaimer below: the shell wraps children in
          space-y-3, whose sibling selector outranks a plain margin-top utility.
          It cannot reach a first child's bottom margin, so this one sticks. */}
      <ul className="mb-6 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {PRODUCTS.map((product) => (
          <li key={product.slug} className="group m-0">
            {/* Fixed square box + fill keeps every tile uniform and reserves its
                own space, so the grid never shifts as the images decode. */}
            <div className="relative aspect-square overflow-hidden rounded border border-forest/15 bg-white">
              <Image
                src={`/merch/${product.slug}.webp`}
                alt={product.alt}
                fill
                sizes="(min-width: 1024px) 224px, (min-width: 640px) 336px, 100vw"
                className="object-contain transition-transform duration-200 motion-safe:group-hover:scale-[1.03]"
              />
            </div>
            <p className="mt-2 font-serif text-[15px] leading-snug text-forest">
              {product.name}
            </p>
          </li>
        ))}
      </ul>

      {/* /70, not the /50 used for muted chrome elsewhere: at 11px uppercase
          mono, /50 measures 3.46:1 on warm white and fails AA. /70 is 6.7:1. */}
      <p className="font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-near-black/70">
        Pre-production samples. Final fabric, fit and colorway may change.
      </p>
    </DcStubPage>
  );
}
