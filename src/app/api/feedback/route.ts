// POST /api/feedback — subscriber bug reports + feedback (FAR-408).
// Powers /help/report-a-bug (type:"bug") and /help/feedback (type:"idea").
// Delivers via Resend to the Faraday inbox. No database, no auth — a public,
// rate-nothing contact form. Refused/empty submissions never send an email.
//
// Env: RESEND_API_KEY (already provisioned for the OTP / ops mailers).

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "Faraday Daily Challenge <challenge@faraday-intelligence.ai>";
const TO = "mykemiller@gmail.com";

const MAX_MESSAGE = 4000;
const MAX_EMAIL = 200;
const MAX_PATH = 300;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: Request) {
  let body: { type?: string; message?: string; email?: string; path?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const type = body.type === "bug" ? "bug" : "idea";
  const message = (body.message || "").trim().slice(0, MAX_MESSAGE);
  const email = (body.email || "").trim().slice(0, MAX_EMAIL);
  const path = (body.path || "").trim().slice(0, MAX_PATH);

  if (message.length < 3) {
    return Response.json({ error: "Please add a little more detail." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Feedback service not configured." }, { status: 500 });
  }

  const label = type === "bug" ? "Bug report" : "Feedback";
  const subject = `[Daily Challenge] ${label}${email ? ` from ${email}` : ""}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#141210">
      <p style="margin:0 0 4px"><strong>${esc(label)}</strong></p>
      <p style="margin:0 0 12px;color:#6b6560">via the Daily Challenge ${type === "bug" ? "Report a Bug" : "Feedback"} page</p>
      <p style="white-space:pre-wrap;margin:0 0 16px">${esc(message)}</p>
      <hr style="border:none;border-top:1px solid #eee6da;margin:16px 0" />
      <p style="margin:0;color:#6b6560;font-size:12px">
        Reply-to: ${email ? esc(email) : "(not provided)"}<br/>
        From page: ${path ? esc(path) : "(unknown)"}
      </p>
    </div>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: TO,
        subject,
        html,
        ...(email ? { reply_to: email } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Resend feedback send failed:", res.status, detail);
      return Response.json({ error: "Could not send — please try again." }, { status: 502 });
    }
  } catch (err) {
    console.error("Resend feedback request errored:", err);
    return Response.json({ error: "Could not send — please try again." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
