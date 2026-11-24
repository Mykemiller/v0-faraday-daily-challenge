import { ImageResponse } from "next/og";
import { receiptBadge } from "@/lib/predicts";
import { predictsGet, type OneResponse } from "@/lib/predicts-api";
import { clampTitle } from "@/lib/predicts-v3";

// Share card for one forecast (FDY-274): forest field, gold hairlines, the
// Predicts mark, the claim and Faraday's probability. No company logos (third-
// party marks never go on an image we hand to other sites). Default fonts only,
// so a font fetch can never fail the card.

export const alt = "Faraday Predicts forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FOREST = "#1C3424";
const GOLD = "#C4922A";
const WHITE = "#F8F5F0";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await predictsGet<OneResponse>(`view=one&id=${encodeURIComponent(id)}`) : null;
  const r = data?.prediction;
  const claim = r ? clampTitle(r.prediction_text, 180) : "Calls you can hold us to.";
  const graded = !!r && r.status !== "active";
  const word = graded ? receiptBadge(r!.outcome)?.label ?? null : null;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: FOREST, color: WHITE, padding: "56px 72px" }}>
        <div style={{ display: "flex", height: 2, background: GOLD }} />
        <div style={{ display: "flex", alignItems: "center", marginTop: 28, fontSize: 28, letterSpacing: 4, color: GOLD }}>
          FARADAY PREDICTS
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: claim.length > 120 ? 40 : 48, lineHeight: 1.25 }}>
          {claim}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
          {r && <div style={{ display: "flex", fontSize: 96, fontWeight: 700, color: GOLD }}>{`${r.probability_score}%`}</div>}
          {word && <div style={{ display: "flex", fontSize: 40, color: WHITE }}>{word}</div>}
        </div>
        <div style={{ display: "flex", height: 2, background: GOLD, marginTop: 28 }} />
      </div>
    ),
    size,
  );
}
