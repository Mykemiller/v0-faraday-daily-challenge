// Faraday Academy — editor proposal proxy.
//
// GET  lists the review queue. POST either opens a proposal (action: "create") or
// withdraws the caller's own (action: "withdraw"). The editor check lives in the
// edge function, not here: this route only forwards the caller's own bearer token,
// so it cannot grant a role it was not given.

import { EDGE_FUNCTIONS_BASE } from "@/lib/supabase";

function authHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = request.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const cookie = request.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;
  return headers;
}

async function relay(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  try {
    return await relay(
      await fetch(`${EDGE_FUNCTIONS_BASE}/academy-ai/proposals${qs}`, { headers: authHeaders(request) }),
    );
  } catch {
    return Response.json({ error: "The queue could not be loaded." }, { status: 502 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "create";
  const path = action === "withdraw" ? "withdraw" : "propose";

  try {
    return await relay(
      await fetch(`${EDGE_FUNCTIONS_BASE}/academy-ai/${path}`, {
        method: "POST",
        headers: authHeaders(request),
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "That didn't come back." }, { status: 502 });
  }
}
