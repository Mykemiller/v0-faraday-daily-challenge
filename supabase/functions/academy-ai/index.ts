import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Faraday Academy — "Go deeper" and "Propose improvement".
//
//   POST /functions/v1/academy-ai/deeper   open to all readers, 5 per day
//   POST /functions/v1/academy-ai/propose  editors only (app_metadata.role)
//   GET  /functions/v1/academy-ai/quota    what's left and when it resets
//
// The browser never names a model, never sees the API key, and never sends lesson
// text: it sends a course code, a lesson id, a selection and a question, and this
// function loads the lesson and the course voice itself. Everything the model
// returns passes through guards.ts before a reader sees it.

import {
  buildSystemPrompt,
  CHIPS,
  type CommercialRules,
  MAX_QUESTION_CHARS,
  MAX_SELECTION_CHARS,
  RESPONSE_SCHEMA,
} from "./prompt.ts";
import {
  applyGuards,
  type GuardedAnswer,
  type ModelAnswer,
  rewriteInstruction,
  scanCopy,
  type CopyViolation,
} from "./guards.ts";
import {
  BURST_PER_HOUR,
  BURST_PER_MINUTE,
  chicagoDay,
  DAILY_LIMIT,
  DEFAULT_RATES,
  decide,
  estimateCostUsd,
  HARD_PER_HOUR,
  nextChicagoMidnight,
  type Rates,
  resolveKeys,
} from "./meter.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;
const MAX_SEARCHES = 6;
// The server-tool loop can pause; resume a bounded number of times.
const MAX_CONTINUATIONS = 4;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-turnstile-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

function env(name: string): string | undefined {
  const v = Deno.env.get(name);
  return v && v.length > 0 ? v : undefined;
}

// ── best-effort in-isolate burst window ──────────────────────────────────────
// academy_ai_usage stores one aggregate row per (key, day) with no timestamps, so
// a true 60-second window cannot be durable in that schema. This map is the
// per-isolate half; the durable half is the per-IP daily thresholds in
// burstSignals() below, which survives isolate recycling.
const recent = new Map<string, number[]>();
function noteHit(key: string, now: number): { lastMinute: number; lastHour: number } {
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) {
    // Bound memory: drop the coldest half.
    const entries = [...recent.entries()].sort((a, b) => (b[1].at(-1) ?? 0) - (a[1].at(-1) ?? 0));
    recent.clear();
    for (const [k, v] of entries.slice(0, 2500)) recent.set(k, v);
  }
  return {
    lastMinute: hits.filter((t) => now - t < 60_000).length,
    lastHour: hits.length,
  };
}

/**
 * Durable burst signal. A single cookie can never exceed the 5/day cap, so the
 * thresholds above it only ever bite on the shared IP-prefix key — where a daily
 * count IS a meaningful proxy for an hourly one, and survives isolate recycling.
 */
function burstSignals(ipDailyCount: number, inIsolate: { lastMinute: number; lastHour: number }) {
  return {
    lastMinute: inIsolate.lastMinute,
    lastHour: Math.max(inIsolate.lastHour, ipDailyCount),
  };
}

// ── data loading ─────────────────────────────────────────────────────────────

type LessonContext = {
  courseId: string;
  courseTitle: string;
  courseCode: string;
  level: string;
  voice: string;
  authorName: string;
  lessonId: string;
  lessonTitle: string | null;
  lessonBody: string;
  moduleId: string;
  moduleTitle: string | null;
  faradaysTake: string | null;
};

const AUTHORS: Record<string, string> = { Gil: "Gilbert Faraday", Mach: "Mach Eigen" };

async function loadLesson(
  db: SupabaseClient,
  courseCode: string,
  lessonId: string,
): Promise<LessonContext | null> {
  const { data: course, error: cErr } = await db
    .from("academy_courses")
    .select("id, course_code, title, level, voice, status")
    .eq("course_code", courseCode)
    .maybeSingle();
  if (cErr || !course) return null;
  if (!["approved", "published"].includes(String(course.status))) return null;

  const { data: lesson, error: lErr } = await db
    .from("academy_course_lessons")
    .select("id, module_id, title, body")
    .eq("id", lessonId)
    .maybeSingle();
  if (lErr || !lesson) return null;

  const { data: mod } = await db
    .from("academy_course_modules")
    .select("id, course_id, title, faradays_take")
    .eq("id", lesson.module_id)
    .maybeSingle();
  // The lesson must belong to the course the caller named.
  if (!mod || mod.course_id !== course.id) return null;

  return {
    courseId: course.id,
    courseTitle: course.title,
    courseCode: course.course_code,
    level: String(course.level),
    voice: String(course.voice),
    authorName: AUTHORS[String(course.voice)] ?? "Faraday Academy",
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    lessonBody: lesson.body ?? "",
    moduleId: mod.id,
    moduleTitle: mod.title,
    faradaysTake: mod.faradays_take,
  };
}

async function loadRules(db: SupabaseClient): Promise<CommercialRules> {
  const { data } = await db
    .from("academy_commercial_rules")
    .select("beta_mode, free_layer_enabled, price_101_usd, price_advanced_usd, certification_price_usd, certification_token_grant, tiers_enabled")
    .limit(1)
    .maybeSingle();
  // Fail closed to beta: an unreadable rules row must never surface a price.
  return {
    beta_mode: data?.beta_mode ?? true,
    free_layer_enabled: data?.free_layer_enabled ?? true,
    price_101_usd: data?.price_101_usd ?? null,
    price_advanced_usd: data?.price_advanced_usd ?? null,
    certification_price_usd: data?.certification_price_usd ?? null,
    certification_token_grant: data?.certification_token_grant ?? null,
    tiers_enabled: data?.tiers_enabled ?? false,
  };
}

// ── Anthropic call ───────────────────────────────────────────────────────────

type AnthropicResult = {
  answer: ModelAnswer | null;
  searchUrls: string[];
  refused: boolean;
  usage: { input_tokens: number; output_tokens: number; searches: number };
  rawText: string;
};

function collectSearchUrls(content: unknown[]): string[] {
  const urls: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block?.type !== "web_search_tool_result") continue;
    const inner = block["content"];
    // On an error the content is an object, not a list — skip it.
    if (!Array.isArray(inner)) continue;
    for (const r of inner as Array<Record<string, unknown>>) {
      const url = r?.["url"];
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}

function collectText(content: unknown[]): string {
  return (content as Array<Record<string, unknown>>)
    .filter((b) => b?.type === "text" && typeof b["text"] === "string")
    .map((b) => b["text"] as string)
    .join("");
}

async function callAnthropic(
  apiKey: string,
  model: string,
  system: string,
  userText: string,
  priorTurns: Array<Record<string, unknown>> = [],
): Promise<AnthropicResult> {
  const messages: Array<Record<string, unknown>> = [
    ...priorTurns,
    { role: "user", content: userText },
  ];

  const searchUrls: string[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, searches: 0 };
  let refused = false;
  let lastContent: unknown[] = [];

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        // Dynamic-filtering web search. Do NOT also declare code_execution: this
        // tool version runs it internally and a second environment confuses the model.
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
        // Structured output. No temperature / top_p / top_k and no thinking budget:
        // those are rejected on current models, and thinking is on by default.
        output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`anthropic ${res.status}: ${detail.slice(0, 400)}`);
    }
    const body = await res.json() as Record<string, unknown>;

    const u = (body["usage"] ?? {}) as Record<string, unknown>;
    usage.input_tokens += Number(u["input_tokens"] ?? 0);
    usage.output_tokens += Number(u["output_tokens"] ?? 0);
    const stu = (u["server_tool_use"] ?? {}) as Record<string, unknown>;
    usage.searches += Number(stu["web_search_requests"] ?? 0);

    const content = (body["content"] ?? []) as unknown[];
    lastContent = content;
    searchUrls.push(...collectSearchUrls(content));

    const stop = body["stop_reason"];
    // Safety classifiers declined. Check this before reading content.
    if (stop === "refusal") {
      refused = true;
      break;
    }
    // The server-tool loop hit its iteration cap; resume by replaying the turn.
    if (stop === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }
    break;
  }

  const rawText = collectText(lastContent);
  if (refused) return { answer: null, searchUrls, refused, usage, rawText };

  let answer: ModelAnswer | null = null;
  try {
    answer = JSON.parse(rawText) as ModelAnswer;
  } catch {
    answer = null;
  }
  return { answer, searchUrls, refused, usage, rawText };
}

// ── usage recording ──────────────────────────────────────────────────────────

async function readUsed(db: SupabaseClient, keys: string[], day: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  const { data } = await db
    .from("academy_ai_usage")
    .select("usage_key, requests")
    .in("usage_key", keys)
    .eq("day", day);
  for (const r of (data ?? []) as Array<{ usage_key: string; requests: number }>) {
    out.set(r.usage_key, r.requests ?? 0);
  }
  return out;
}

async function recordUsage(
  db: SupabaseClient,
  key: string,
  day: string,
  userId: string | null,
  delta: { requests: number; input: number; output: number; searches: number; cost: number },
): Promise<void> {
  // Read-modify-write. A lost update here under-counts a burst, never over-counts
  // the allowance, and the IP key catches what a racing cookie would slip through.
  const { data } = await db
    .from("academy_ai_usage")
    .select("requests, input_tokens, output_tokens, search_calls, cost_usd")
    .eq("usage_key", key)
    .eq("day", day)
    .maybeSingle();

  const row = {
    usage_key: key,
    day,
    user_id: userId,
    requests: (data?.requests ?? 0) + delta.requests,
    input_tokens: (data?.input_tokens ?? 0) + delta.input,
    output_tokens: (data?.output_tokens ?? 0) + delta.output,
    search_calls: (data?.search_calls ?? 0) + delta.searches,
    cost_usd: Number(data?.cost_usd ?? 0) + delta.cost,
  };
  await db.from("academy_ai_usage").upsert(row, { onConflict: "usage_key,day" });
}

async function daySpend(db: SupabaseClient, day: string): Promise<number> {
  const { data } = await db.from("academy_ai_usage").select("cost_usd").eq("day", day);
  return (data ?? []).reduce((sum: number, r: { cost_usd: number | null }) => sum + Number(r.cost_usd ?? 0), 0);
}

// ── auth ─────────────────────────────────────────────────────────────────────

type Caller = { userId: string | null; role: string | null };

async function identify(db: SupabaseClient, authHeader: string | null): Promise<Caller> {
  if (!authHeader?.startsWith("Bearer ")) return { userId: null, role: null };
  const token = authHeader.slice(7);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data?.user) return { userId: null, role: null };
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  return { userId: data.user.id, role: typeof meta["role"] === "string" ? meta["role"] as string : null };
}

async function turnstileOk(token: string | null): Promise<boolean> {
  const secret = env("TURNSTILE_SECRET_KEY");
  if (!secret) return false;
  if (!token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    const body = await res.json() as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── prompt assembly ──────────────────────────────────────────────────────────

function buildUserTurn(opts: {
  ctx: LessonContext;
  selection: string | null;
  ask: string;
  persona: string | null;
  mode: "deeper" | "propose";
  proposeKind?: string;
  target?: string;
}): string {
  const lines: string[] = [];
  lines.push(`COURSE: ${opts.ctx.courseTitle} (level ${opts.ctx.level})`);
  lines.push(`AUTHOR VOICE: ${opts.ctx.voice}`);
  lines.push(`MODULE: ${opts.ctx.moduleTitle ?? "(untitled)"}`);
  lines.push(`LESSON: ${opts.ctx.lessonTitle ?? "(untitled)"}`);
  if (opts.persona) lines.push(`READER PERSONA: ${opts.persona}`);
  lines.push("");
  lines.push("LESSON TEXT:");
  lines.push(opts.ctx.lessonBody);
  lines.push("");
  if (opts.selection) {
    lines.push("THE READER SELECTED THIS PASSAGE:");
    lines.push(opts.selection);
    lines.push("");
  }
  if (opts.mode === "propose") {
    lines.push(`PROPOSE MODE. Target: ${opts.target}. Action: ${opts.proposeKind}.`);
    if (opts.target === "faradays_take") {
      lines.push("CURRENT TAKE:");
      lines.push(opts.ctx.faradaysTake ?? "(none)");
      lines.push("");
    }
    lines.push("Produce a proposal, not an edit. Narration-ready prose only.");
    lines.push("");
  }
  lines.push(`REQUEST: ${opts.ask}`);
  return lines.join("\n");
}

// ── handlers ─────────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

async function handleDeeper(req: Request, db: SupabaseClient, mode: "deeper" | "propose"): Promise<Response> {
  const apiKey = env("ANTHROPIC_API_KEY");
  const cookieSecret = env("ACADEMY_COOKIE_SECRET");
  if (!apiKey || !cookieSecret) {
    console.error("academy-ai: missing ANTHROPIC_API_KEY or ACADEMY_COOKIE_SECRET");
    return json({ kind: "error", message: "The panel isn't configured yet." }, 503);
  }
  // Namespaced deliberately: Supabase function secrets are PROJECT-wide, so a
  // generic ANTHROPIC_MODEL would be shared with faraday-crawl and any future
  // function. The API key is shared on purpose (one account, one bill); the model
  // choice is not.
  const model = env("ACADEMY_AI_MODEL") ?? DEFAULT_MODEL;

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return json({ kind: "error", message: "Bad request." }, 400);
  }

  const courseCode = str(body["course_code"], 64);
  const lessonId = str(body["lesson_id"], 64);
  const ask = str(body["ask"], MAX_QUESTION_CHARS);
  const persona = str(body["persona"], 80);
  const rawSelection = str(body["selection"], MAX_SELECTION_CHARS);
  if (!courseCode || !lessonId || !ask) {
    return json({ kind: "error", message: "Bad request." }, 400);
  }

  const caller = await identify(db, req.headers.get("authorization"));

  // Propose mode is editors only.
  if (mode === "propose" && caller.role !== "editor") {
    return json({ kind: "error", message: "Not found" }, 404);
  }

  const ctx = await loadLesson(db, courseCode, lessonId);
  if (!ctx) return json({ kind: "error", message: "Not found" }, 404);

  // A selection that is not actually in this lesson is treated as a question —
  // it may be pasted from elsewhere, and we will not quote it back as lesson text.
  const selection = rawSelection && ctx.lessonBody.includes(rawSelection) ? rawSelection : null;
  const effectiveAsk = rawSelection && !selection
    ? `${ask}\n\n(The reader also typed: ${rawSelection})`
    : ask;

  const now = new Date();
  const day = chicagoDay(now);
  const keys = await resolveKeys({
    userId: caller.userId,
    cookieHeader: req.headers.get("cookie"),
    ip: req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip"),
    secret: cookieSecret,
  });

  const keyList = [keys.primary, ...(keys.secondary ? [keys.secondary] : [])];
  const used = await readUsed(db, keyList, day);
  const usedPrimary = used.get(keys.primary) ?? 0;
  const usedSecondary = keys.secondary ? (used.get(keys.secondary) ?? 0) : 0;

  const capUsd = Number(env("ACADEMY_AI_DAILY_SPEND_CAP_USD") ?? "0");
  const spentToday = capUsd > 0 ? await daySpend(db, day) : 0;
  const spendCapReached = capUsd > 0 && spentToday >= capUsd;

  const inIsolate = noteHit(keys.secondary ?? keys.primary, now.getTime());
  const signals = burstSignals(usedSecondary, inIsolate);
  const passed = await turnstileOk(req.headers.get("x-turnstile-token"));

  const decision = decide({
    usedPrimary,
    usedSecondary,
    lastMinute: signals.lastMinute,
    lastHour: signals.lastHour,
    turnstilePassed: passed,
    spendCapReached,
    now,
  });

  const cookieHeaders: Record<string, string> = keys.setCookie ? { "Set-Cookie": keys.setCookie } : {};

  if (!decision.allow) {
    const status = decision.reason === "throttled" ? 429 : 200;
    return json(
      {
        kind: decision.reason === "turnstile" ? "turnstile_required" : "limited",
        reason: decision.reason,
        remaining: decision.remaining,
        limit: DAILY_LIMIT,
        resets_at: decision.resetsAt,
      },
      status,
      cookieHeaders,
    );
  }

  const rules = await loadRules(db);
  const system = buildSystemPrompt(rules);
  const userTurn = buildUserTurn({
    ctx,
    selection,
    ask: effectiveAsk,
    persona,
    mode,
    proposeKind: str(body["kind"], 40) ?? "add_references",
    target: str(body["target"], 40) ?? "lesson_body",
  });

  const rates: Rates = {
    inputPerMTok: Number(env("ACADEMY_AI_INPUT_PER_MTOK") ?? DEFAULT_RATES.inputPerMTok),
    outputPerMTok: Number(env("ACADEMY_AI_OUTPUT_PER_MTOK") ?? DEFAULT_RATES.outputPerMTok),
    perSearch: Number(env("ACADEMY_AI_PER_SEARCH") ?? DEFAULT_RATES.perSearch),
  };

  const totals = { input: 0, output: 0, searches: 0 };
  let finalAnswer: GuardedAnswer | null = null;
  let notes: string[] = [];
  let refusalReason: string | null = null;

  try {
    let attempt = await callAnthropic(apiKey, model, system, userTurn);
    totals.input += attempt.usage.input_tokens;
    totals.output += attempt.usage.output_tokens;
    totals.searches += attempt.usage.searches;

    if (attempt.refused) {
      refusalReason = "This one is outside what I can answer.";
    } else if (!attempt.answer) {
      // Invalid structured output. One retry, then a refusal.
      const retry = await callAnthropic(
        apiKey,
        model,
        system,
        `${userTurn}\n\nYour previous reply was not valid JSON for the required schema. Return only the JSON object.`,
      );
      totals.input += retry.usage.input_tokens;
      totals.output += retry.usage.output_tokens;
      totals.searches += retry.usage.searches;
      attempt = { ...retry, searchUrls: [...attempt.searchUrls, ...retry.searchUrls] };
      if (!attempt.answer) refusalReason = "I couldn't put that in a form I trust. Nothing is shown rather than something unchecked.";
    }

    if (!refusalReason && attempt.answer) {
      let guarded = applyGuards(attempt.answer, attempt.searchUrls, { allowPrices: !rules.beta_mode });

      // The copy guard gets exactly one rewrite, then it is a refusal.
      if (guarded.needsRewrite) {
        const violations: CopyViolation[] = [];
        for (const p of guarded.answer.paragraphs ?? []) {
          violations.push(...scanCopy(p.text, "paragraph", !rules.beta_mode));
        }
        const rewrite = await callAnthropic(
          apiKey,
          model,
          system,
          `${userTurn}\n\n${rewriteInstruction(violations)}`,
        );
        totals.input += rewrite.usage.input_tokens;
        totals.output += rewrite.usage.output_tokens;
        totals.searches += rewrite.usage.searches;
        if (rewrite.answer) {
          const second = applyGuards(
            rewrite.answer,
            [...attempt.searchUrls, ...rewrite.searchUrls],
            { allowPrices: !rules.beta_mode },
          );
          guarded = second.needsRewrite
            ? { ...second, refuse: true }
            : second;
        } else {
          guarded = { ...guarded, refuse: true };
        }
      }

      if (guarded.refuse) {
        refusalReason = refusalReason ??
          "I couldn't support that from sources I can name, so there's nothing to show.";
      } else {
        finalAnswer = guarded.answer;
        notes = guarded.notes;
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("academy-ai call failed:", detail);
    // An operator presenting the validate secret gets the upstream error verbatim.
    // Readers never do. Supabase log queries are not always available, and a
    // generic "try again" with no way to see the cause is how a 400 from a schema
    // change stays invisible.
    const diag = env("ACADEMY_VALIDATE_SECRET");
    const given = req.headers.get("x-academy-validate-secret");
    const showDetail = Boolean(diag && given && given === diag);
    // A failed call still costs whatever it burned; record it, then report plainly.
    await recordUsage(db, keys.primary, day, caller.userId, {
      requests: 1,
      input: totals.input,
      output: totals.output,
      searches: totals.searches,
      cost: estimateCostUsd({ input_tokens: totals.input, output_tokens: totals.output, searches: totals.searches }, rates),
    });
    return json(
      showDetail
        ? { kind: "error", message: "That didn't come back. Try again in a moment.", detail }
        : { kind: "error", message: "That didn't come back. Try again in a moment." },
      502,
      cookieHeaders,
    );
  }

  const cost = estimateCostUsd(
    { input_tokens: totals.input, output_tokens: totals.output, searches: totals.searches },
    rates,
  );
  // Every call is recorded, answered or refused — the cost was spent either way.
  await recordUsage(db, keys.primary, day, caller.userId, {
    requests: 1, input: totals.input, output: totals.output, searches: totals.searches, cost,
  });
  if (keys.secondary) {
    await recordUsage(db, keys.secondary, day, null, {
      requests: 1, input: 0, output: 0, searches: 0, cost: 0,
    });
  }

  const remaining = Math.max(DAILY_LIMIT - (Math.max(usedPrimary, usedSecondary) + 1), 0);
  const meta = {
    remaining,
    limit: DAILY_LIMIT,
    resets_at: nextChicagoMidnight(now).toISOString(),
    retrieved_on: day,
    label: "Supplementary AI material",
  };

  if (!finalAnswer) {
    return json({ kind: "refusal", refusal_reason: refusalReason, notes, ...meta }, 200, cookieHeaders);
  }

  // Propose mode writes a proposal and returns it; nothing touches lesson text.
  if (mode === "propose") {
    const target = str(body["target"], 40) === "faradays_take" ? "faradays_take" : "lesson_body";
    const baseText = target === "faradays_take" ? (ctx.faradaysTake ?? "") : ctx.lessonBody;
    const proposedText = (finalAnswer.paragraphs ?? []).map((p) => p.text).join("\n\n");
    const assetSpec: Record<string, unknown> = {};
    if (finalAnswer.diagram) assetSpec["diagram"] = finalAnswer.diagram;
    if (finalAnswer.chart) assetSpec["chart"] = finalAnswer.chart;

    const { data: inserted, error: insErr } = await db
      .from("academy_content_proposals")
      .insert({
        course_id: ctx.courseId,
        module_id: ctx.moduleId,
        lesson_id: target === "lesson_body" ? ctx.lessonId : null,
        target,
        kind: str(body["kind"], 40) ?? "add_references",
        base_hash: await sha256Hex(baseText),
        diff: { before_excerpt: baseText.slice(0, 600), after_excerpt: proposedText.slice(0, 600) },
        proposed_text: proposedText,
        sources: finalAnswer.sources ?? [],
        asset_spec: Object.keys(assetSpec).length > 0 ? assetSpec : null,
        status: "proposed",
        proposed_by: caller.userId,
      })
      .select("id, status, created_at")
      .single();

    if (insErr) {
      console.error("academy-ai: proposal insert failed:", insErr.message);
      return json({ kind: "error", message: "The proposal could not be saved." }, 500, cookieHeaders);
    }
    return json({ kind: "proposal", proposal: inserted, answer: finalAnswer, notes, ...meta }, 200, cookieHeaders);
  }

  return json({ kind: "answer", answer: finalAnswer, notes, ...meta }, 200, cookieHeaders);
}

async function handleQuota(req: Request, db: SupabaseClient): Promise<Response> {
  const cookieSecret = env("ACADEMY_COOKIE_SECRET");
  if (!cookieSecret) return json({ remaining: DAILY_LIMIT, limit: DAILY_LIMIT, resets_at: null });
  const caller = await identify(db, req.headers.get("authorization"));
  const now = new Date();
  const day = chicagoDay(now);
  const keys = await resolveKeys({
    userId: caller.userId,
    cookieHeader: req.headers.get("cookie"),
    ip: req.headers.get("x-forwarded-for"),
    secret: cookieSecret,
  });
  const used = await readUsed(db, [keys.primary, ...(keys.secondary ? [keys.secondary] : [])], day);
  const consumed = Math.max(used.get(keys.primary) ?? 0, keys.secondary ? (used.get(keys.secondary) ?? 0) : 0);
  return json(
    {
      remaining: Math.max(DAILY_LIMIT - consumed, 0),
      limit: DAILY_LIMIT,
      resets_at: nextChicagoMidnight(now).toISOString(),
      chips: CHIPS,
      burst: { per_minute: BURST_PER_MINUTE, per_hour: BURST_PER_HOUR, hard_per_hour: HARD_PER_HOUR },
    },
    200,
    keys.setCookie ? { "Set-Cookie": keys.setCookie } as Record<string, string> : {},
  );
}

// ── editor surfaces ─────────────────────────────────────────────────────────

/**
 * The review queue. Editors only. Returns proposals grouped-ready (the client
 * groups by course) with everything a reviewer needs to judge one: the diff, the
 * sources, the asset spec, and the Argus verdict when Argus has written one.
 *
 * Read with the service role after checking the caller's role here, because
 * academy_content_proposals has a select policy for editors but no insert or
 * update policy for anyone — all writes are service-role, so reads stay here too.
 */
async function handleProposals(req: Request, db: SupabaseClient): Promise<Response> {
  const caller = await identify(db, req.headers.get("authorization"));
  if (caller.role !== "editor") return json({ error: "Not found" }, 404);

  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  let q = db
    .from("academy_content_proposals")
    .select(
      "id, course_id, module_id, lesson_id, target, kind, base_hash, diff, proposed_text, sources, asset_spec, status, argus_verdict, review_note, proposed_by, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", status);

  const { data: proposals, error } = await q;
  if (error) {
    console.error("academy-ai: proposal read failed:", error.message);
    return json({ error: "Internal error" }, 500);
  }

  // Course titles, so the queue can group by course without exposing a code.
  const courseIds = [...new Set((proposals ?? []).map((p) => p.course_id))];
  const titles = new Map<string, { title: string; slug: string | null }>();
  if (courseIds.length > 0) {
    const { data: courses } = await db
      .from("academy_courses")
      .select("id, title, public_slug")
      .in("id", courseIds);
    for (const c of (courses ?? []) as Array<{ id: string; title: string; public_slug: string | null }>) {
      titles.set(c.id, { title: c.title, slug: c.public_slug });
    }
  }

  return json({
    viewer: { user_id: caller.userId },
    proposals: (proposals ?? []).map((p) => ({
      ...p,
      course: titles.get(p.course_id) ?? null,
      is_mine: p.proposed_by === caller.userId,
    })),
  });
}

/**
 * Withdraw. An editor may retire their OWN proposal to `superseded` and nothing
 * else: ownership is checked here, and the status target is hard-coded rather than
 * taken from the request, so this endpoint cannot be used to advance a proposal
 * toward `accepted`. That transition belongs to Myke's review tool, which is the
 * only thing that sets academy.proposal_owner.
 */
async function handleWithdraw(req: Request, db: SupabaseClient): Promise<Response> {
  const caller = await identify(db, req.headers.get("authorization"));
  if (caller.role !== "editor" || !caller.userId) return json({ error: "Not found" }, 404);

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const id = str(body["proposal_id"], 64);
  if (!id) return json({ error: "Bad request" }, 400);

  const { data: existing } = await db
    .from("academy_content_proposals")
    .select("id, proposed_by, status")
    .eq("id", id)
    .maybeSingle();

  // Same opaque 404 whether it is missing or someone else's.
  if (!existing || existing.proposed_by !== caller.userId) return json({ error: "Not found" }, 404);
  // Only a proposal still in play can be withdrawn.
  if (!["proposed", "argus_review", "returned"].includes(String(existing.status))) {
    return json({ error: "That proposal can no longer be withdrawn." }, 409);
  }

  const { data: updated, error } = await db
    .from("academy_content_proposals")
    .update({ status: "superseded", review_note: str(body["note"], 500) })
    .eq("id", id)
    .eq("proposed_by", caller.userId)
    .select("id, status, updated_at")
    .single();

  if (error) {
    console.error("academy-ai: withdraw failed:", error.message);
    return json({ error: "Internal error" }, 500);
  }
  return json({ proposal: updated });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("academy-ai");
  const route = (i >= 0 ? parts.slice(i + 1) : parts)[0] ?? "";

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    if (req.method === "GET" && route === "quota") return await handleQuota(req, db);
    if (req.method === "POST" && route === "deeper") return await handleDeeper(req, db, "deeper");
    if (req.method === "POST" && route === "propose") return await handleDeeper(req, db, "propose");
    if (req.method === "GET" && route === "proposals") return await handleProposals(req, db);
    if (req.method === "POST" && route === "withdraw") return await handleWithdraw(req, db);
    return json({ kind: "error", message: "Not found" }, 404);
  } catch (err) {
    console.error("academy-ai error:", err instanceof Error ? err.message : err);
    return json({ kind: "error", message: "Internal error" }, 500);
  }
});
