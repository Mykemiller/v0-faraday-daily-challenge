import StubPage from "@/components/StubPage";

export const metadata = { title: "Faraday Academy" };

export default function Page() {
  return (
    <StubPage
      title="Faraday Academy"
      tagline="Structured learning for the AI data center economy."
      status="In build"
      meteredNote="Priced separately — Faraday Academy is its own product, not token-metered."
    >
      <p>
        Faraday Academy is structured education on the AI data center economy — courses that turn Faraday&apos;s
        intelligence into durable understanding, from power architecture to capital markets.
      </p>
      <p>Delivered on LearnWorlds, and priced separately from the token economy.</p>
    </StubPage>
  );
}
