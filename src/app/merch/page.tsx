import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Faraday Merchandise" };

// More Faraday → Faraday Merchandise stub. No storefront (external or internal)
// exists yet — if merch ends up on an external shop, repoint the menu item in
// buildHeaderMenus/buildSiteMenus instead of building this page out.

export default function MerchPage() {
  return (
    <DcStubPage
      title="Faraday Merchandise"
      blurb="Wear the streak. Faraday merch is in the works."
    >
      <p>The shop isn&rsquo;t open yet — check back soon.</p>
    </DcStubPage>
  );
}
