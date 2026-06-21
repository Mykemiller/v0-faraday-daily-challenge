// POST /api/subscribe — waitlist → Beehiiv. Ported from the brand site's
// api/subscribe.js. Requires env: BEEHIIV_API_KEY, BEEHIIV_PUB_ID.

export async function POST(request: Request) {
  let body: { email?: string; ref?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email || "").trim();
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Valid email required" }, { status: 400 });
  }

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUB_ID;
  if (!apiKey || !pubId) {
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    const beehiivRes = await fetch(
      `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          email,
          reactivate_existing: false,
          send_welcome_email: true,
          utm_source: body.ref || "faraday-website",
          utm_medium: "organic",
          utm_campaign: "mvp-beta",
        }),
      }
    );
    const data = await beehiivRes.json();
    if (!beehiivRes.ok) {
      return Response.json({ error: data?.message || "Subscription failed" }, { status: beehiivRes.status });
    }
    return Response.json({ success: true, id: data?.data?.id });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
