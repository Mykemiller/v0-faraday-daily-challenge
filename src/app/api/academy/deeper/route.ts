// Faraday Academy — "Go deeper" proxy.
//
// A thin forwarder to the academy-ai edge function. It exists so the browser talks
// to its own origin: the metering cookie is httpOnly and first-party, which it
// could not be if the browser called the function host directly.
//
// Payload is capped here as well as in the function — a proxy that forwards
// anything is just a bigger attack surface.

import { EDGE_FUNCTIONS_BASE } from "@/lib/supabase";

const MAX_SELECTION = 1200;
const MAX_QUESTION = 500;

function clamp(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ kind: "error", message: "Bad request." }, { status: 400 });
  }

  const forwarded = {
    course_code: clamp(body.course_code, 64),
    lesson_id: clamp(body.lesson_id, 64),
    selection: clamp(body.selection, MAX_SELECTION),
    ask: clamp(body.ask, MAX_QUESTION),
    persona: clamp(body.persona, 80),
    mode: "deeper",
  };
  if (!forwarded.course_code || !forwarded.lesson_id || !forwarded.ask) {
    return Response.json({ kind: "error", message: "Bad request." }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Pass the reader's cookie through so the function sees its own metering id,
  // and the Turnstile token when the panel has solved a challenge.
  const cookie = request.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;
  const turnstile = request.headers.get("x-turnstile-token");
  if (turnstile) headers["x-turnstile-token"] = turnstile;
  const auth = request.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;

  try {
    const upstream = await fetch(`${EDGE_FUNCTIONS_BASE}/academy-ai/deeper`, {
      method: "POST",
      headers,
      body: JSON.stringify(forwarded),
    });

    const text = await upstream.text();
    const out = new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
    // Relay the metering cookie so it is set first-party on this origin.
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) out.headers.append("Set-Cookie", setCookie);
    return out;
  } catch {
    return Response.json(
      { kind: "error", message: "That didn't come back. Try again in a moment." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;
  const auth = request.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;

  try {
    const upstream = await fetch(`${EDGE_FUNCTIONS_BASE}/academy-ai/quota`, { headers });
    const text = await upstream.text();
    const out = new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) out.headers.append("Set-Cookie", setCookie);
    return out;
  } catch {
    // The panel treats an unreachable quota as "unknown" and still lets one try.
    return Response.json({ remaining: null, limit: 5, resets_at: null }, { status: 200 });
  }
}
