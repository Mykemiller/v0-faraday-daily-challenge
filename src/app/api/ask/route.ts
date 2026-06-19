// POST /api/ask  — server-side Ask Faraday.
// Ported from the brand site's client-side call (which hit api.anthropic.com from
// the browser with no key — hence the "Something went wrong" error). The key now
// stays server-side. Requires env: ANTHROPIC_API_KEY.

const SYSTEM = `You are Faraday — an AI intelligence service specializing in the AI data center economy. Your voice: authoritative, warm, dry precision. You track the AI data center economy across a curated set of Intelligence Domains including: Chips & Density, Power Architecture, Grid & Regulatory, M&A & Capital Markets, Hyperscaler Activity, New Entrants, Cooling & Water Technology, People & Signals, Orchestration & Control Plane, Construction, Sustainability, Networking & Interconnect, Community Relations, Real Estate & Site Selection, Sovereign AI & Geopolitics, Security & Resilience, Workforce & Labor Markets, and Community Opposition & Regulatory Risk.

Answer the question clearly and substantively in 3-5 sentences. Use precise industry terminology. Be direct and confident — you are not a search engine, you are an intelligence service. Do not use markdown formatting, bullet points, or headers. Write in flowing prose. End with one forward-looking insight or implication.`;

export async function POST(request: Request) {
  let body: { q?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const q = (body.q || "").trim();
  if (!q) return Response.json({ error: "Missing question" }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Server not configured: ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: "user", content: q }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return Response.json({ error: data?.error?.message || "Upstream error" }, { status: 502 });
    }

    const answer =
      Array.isArray(data?.content)
        ? data.content.find((b: { type?: string }) => b.type === "text")?.text ?? ""
        : "";
    return Response.json({ answer });
  } catch {
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
