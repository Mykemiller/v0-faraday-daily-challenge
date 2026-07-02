import DcStubPage from "@/components/DcStubPage";

export const metadata = { title: "Terms / Privacy · Faraday Intelligence" };

// More Faraday → Terms / Privacy stub. One page for both documents until
// counsel-reviewed copy exists; split into /terms and /privacy then if needed.

export default function LegalPage() {
  return (
    <DcStubPage
      title="Terms / Privacy"
      blurb="The terms of service and privacy policy for Faraday Intelligence and the Daily Challenge."
    >
      <p>
        Final terms of service and privacy policy are being prepared and will be published
        here. Until then, questions about your data can go through the Feedback page.
      </p>
    </DcStubPage>
  );
}
