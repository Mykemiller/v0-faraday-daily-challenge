// Unit tests for faraday-todo-daily (AUTO-050).
// Run with: deno test supabase/functions/faraday-todo-daily/faraday-todo-daily.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  ctDateString,
  ctHour,
  isCtHour5,
  jiraBasicAuth,
  priorityBand,
  isBlockedIssue,
  esc,
  buildEmailHtml,
  buildFailureEmailHtml,
  type DigestData,
  type JiraIssue,
  type GithubPR,
  type GithubCommit,
} from "./index.ts";

// ─── ctDateString ─────────────────────────────────────────────────────────────

Deno.test("ctDateString — returns YYYY-MM-DD format", () => {
  const d = new Date("2026-06-24T10:30:00Z"); // 05:30 CDT
  const result = ctDateString(d);
  assertEquals(result, "2026-06-24");
});

Deno.test("ctDateString — UTC midnight is still previous CT day", () => {
  // 2026-06-24T00:00:00Z = 2026-06-23T19:00:00-05:00 CT
  const d = new Date("2026-06-24T00:00:00Z");
  assertEquals(ctDateString(d), "2026-06-23");
});

// ─── ctHour ───────────────────────────────────────────────────────────────────

Deno.test("ctHour — 10:00 UTC in CDT is hour 5", () => {
  // America/Chicago CDT = UTC-5; 10:00 UTC = 05:00 CDT
  const d = new Date("2026-06-24T10:00:00Z");
  assertEquals(ctHour(d), 5);
});

Deno.test("ctHour — 11:00 UTC in CST is hour 5", () => {
  // America/Chicago CST = UTC-6; 11:00 UTC = 05:00 CST (winter)
  const d = new Date("2026-12-24T11:00:00Z");
  assertEquals(ctHour(d), 5);
});

Deno.test("ctHour — 12:00 UTC in CDT is hour 7 not 5", () => {
  const d = new Date("2026-06-24T12:00:00Z");
  assertEquals(ctHour(d), 7);
});

// ─── isCtHour5 ────────────────────────────────────────────────────────────────

Deno.test("isCtHour5 — true when CDT hour is 5", () => {
  const d = new Date("2026-06-24T10:30:00Z");
  assertEquals(isCtHour5(d), true);
});

Deno.test("isCtHour5 — true when CST hour is 5 (winter)", () => {
  const d = new Date("2026-12-24T11:45:00Z");
  assertEquals(isCtHour5(d), true);
});

Deno.test("isCtHour5 — false for hour 4 CT", () => {
  const d = new Date("2026-06-24T09:00:00Z"); // 04:00 CDT
  assertEquals(isCtHour5(d), false);
});

Deno.test("isCtHour5 — false for hour 6 CT", () => {
  const d = new Date("2026-06-24T11:00:00Z"); // 06:00 CDT
  assertEquals(isCtHour5(d), false);
});

// ─── jiraBasicAuth ────────────────────────────────────────────────────────────

Deno.test("jiraBasicAuth — produces valid Basic token", () => {
  const token = jiraBasicAuth("user@example.com", "mytoken");
  assertEquals(token.startsWith("Basic "), true);
  const decoded = atob(token.slice(6));
  assertEquals(decoded, "user@example.com:mytoken");
});

// ─── priorityBand ────────────────────────────────────────────────────────────

Deno.test("priorityBand — Highest → P1", () => {
  assertEquals(priorityBand("Highest", []), "P1");
});

Deno.test("priorityBand — Critical → P1", () => {
  assertEquals(priorityBand("Critical", []), "P1");
});

Deno.test("priorityBand — label p1 overrides medium priority", () => {
  assertEquals(priorityBand("Medium", ["p1", "backend"]), "P1");
});

Deno.test("priorityBand — High → P2", () => {
  assertEquals(priorityBand("High", []), "P2");
});

Deno.test("priorityBand — label p2 overrides Low", () => {
  assertEquals(priorityBand("Low", ["p2"]), "P2");
});

Deno.test("priorityBand — Medium → P3", () => {
  assertEquals(priorityBand("Medium", []), "P3");
});

Deno.test("priorityBand — Low → P4", () => {
  assertEquals(priorityBand("Low", []), "P4");
});

Deno.test("priorityBand — unknown priority → P4", () => {
  assertEquals(priorityBand("Backlog", []), "P4");
});

// ─── isBlockedIssue ──────────────────────────────────────────────────────────

Deno.test("isBlockedIssue — status 'Blocked' matches", () => {
  assertEquals(isBlockedIssue("Blocked", []), true);
});

Deno.test("isBlockedIssue — status 'In Progress' with blocked label matches", () => {
  assertEquals(isBlockedIssue("In Progress", ["blocked", "backend"]), true);
});

Deno.test("isBlockedIssue — 'needs-myke' label matches", () => {
  assertEquals(isBlockedIssue("In Progress", ["needs-myke"]), true);
});

Deno.test("isBlockedIssue — 'governance' label matches", () => {
  assertEquals(isBlockedIssue("Open", ["governance"]), true);
});

Deno.test("isBlockedIssue — 'decision-needed' label matches", () => {
  assertEquals(isBlockedIssue("Open", ["decision-needed"]), true);
});

Deno.test("isBlockedIssue — normal open issue is not blocked", () => {
  assertEquals(isBlockedIssue("In Progress", ["backend", "p2"]), false);
});

// ─── esc ─────────────────────────────────────────────────────────────────────

Deno.test("esc — escapes HTML special chars", () => {
  assertEquals(esc('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

Deno.test("esc — escapes ampersand", () => {
  assertEquals(esc("AT&T"), "AT&amp;T");
});

// ─── buildEmailHtml ───────────────────────────────────────────────────────────

function makeDigest(overrides: Partial<DigestData> = {}): DigestData {
  const p1: JiraIssue = {
    key: "FAR-42",
    summary: "Enable pricing module",
    status: "In Progress",
    priority: "Highest",
    band: "P1",
    assignee: "Myke",
    labels: [],
    blockedBy: [],
    ccBundle: ["CC-13"],
  };

  const blocked: JiraIssue = {
    key: "FAR-190",
    summary: "Add source_type enum for email",
    status: "Blocked",
    priority: "High",
    band: "P2",
    assignee: null,
    labels: ["needs-myke"],
    blockedBy: ["FAR-42"],
    ccBundle: [],
  };

  const commit: GithubCommit = {
    repo: "v0-faraday-daily-challenge",
    sha: "abc12345",
    message: "feat(crawl): add batch hardening",
    author: "mykemiller",
    url: "https://github.com/mykemiller/v0-faraday-daily-challenge/commit/abc12345",
    timestamp: "2026-06-24T10:00:00Z",
  };

  const openPR: GithubPR = {
    repo: "v0-faraday-daily-challenge",
    number: 27,
    title: "fix: adjust cron schedule for DST",
    state: "open",
    url: "https://github.com/mykemiller/v0-faraday-daily-challenge/pull/27",
    updatedAt: "2026-06-24T09:00:00Z",
  };

  const mergedPR: GithubPR = {
    repo: "Faraday-intelligence",
    number: 5,
    title: "fix: ingest-email auto-id",
    state: "merged",
    url: "https://github.com/mykemiller/Faraday-intelligence/pull/5",
    updatedAt: "2026-06-24T08:00:00Z",
  };

  return {
    date: "2026-06-24",
    p1Issues: [p1],
    allOpenIssues: [p1, blocked],
    transitions: [{ key: "FAR-50", summary: "Write daily ops", fromStatus: "Todo", toStatus: "In Progress", timestamp: "2026-06-24T09:00:00Z" }],
    openPRs: [openPR],
    mergedPRs: [mergedPR],
    notableCommits: [commit],
    blockedIssues: [blocked],
    engineHealth: { artifactsLast24h: 47, staleAutoIds: [], healthLogCount: 22 },
    counts: { P1: 1, P2: 1, P3: 0, P4: 0 },
    errors: [],
    ...overrides,
  };
}

Deno.test("buildEmailHtml — contains date header", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "2026-06-24");
  assertStringIncludes(html, "Myke's Faraday Todo List");
});

Deno.test("buildEmailHtml — shows P1 issue key and summary", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "FAR-42");
  assertStringIncludes(html, "Enable pricing module");
});

Deno.test("buildEmailHtml — shows CC bundle link", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "CC-13");
});

Deno.test("buildEmailHtml — shows blocked issue with needs-myke label", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "FAR-190");
  assertStringIncludes(html, "needs-myke");
});

Deno.test("buildEmailHtml — shows transition arrow", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "Todo");
  assertStringIncludes(html, "In Progress");
});

Deno.test("buildEmailHtml — shows merged PR", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "Faraday-intelligence #5");
  assertStringIncludes(html, "ingest-email auto-id");
});

Deno.test("buildEmailHtml — shows open PR", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "v0-faraday-daily-challenge #27");
});

Deno.test("buildEmailHtml — shows commit sha and message", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "abc12345");
  assertStringIncludes(html, "feat(crawl): add batch hardening");
});

Deno.test("buildEmailHtml — shows engine health artifact count", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "47");
});

Deno.test("buildEmailHtml — shows stale automation warning when present", () => {
  const html = buildEmailHtml(makeDigest({ engineHealth: { artifactsLast24h: 0, staleAutoIds: ["AUTO-022"], healthLogCount: 0 } }));
  assertStringIncludes(html, "AUTO-022");
  assertStringIncludes(html, "Stale automations");
});

Deno.test("buildEmailHtml — no open P1s shows green message", () => {
  const html = buildEmailHtml(makeDigest({ p1Issues: [], counts: { P1: 0, P2: 1, P3: 0, P4: 0 } }));
  assertStringIncludes(html, "No open P1");
});

Deno.test("buildEmailHtml — shows error banner when errors present", () => {
  const html = buildEmailHtml(makeDigest({ errors: ["JIRA_API_TOKEN not set"] }));
  assertStringIncludes(html, "Partial data");
  assertStringIncludes(html, "JIRA_API_TOKEN not set");
});

Deno.test("buildEmailHtml — count badges rendered", () => {
  const html = buildEmailHtml(makeDigest());
  assertStringIncludes(html, "P1: 1");
  assertStringIncludes(html, "P2: 1");
});

Deno.test("buildEmailHtml — HTML special chars in summary are escaped", () => {
  const digest = makeDigest({
    p1Issues: [{
      key: "FAR-99",
      summary: "<script>alert('xss')</script>",
      status: "Open",
      priority: "Highest",
      band: "P1",
      assignee: null,
      labels: [],
      blockedBy: [],
      ccBundle: [],
    }],
  });
  const html = buildEmailHtml(digest);
  // Raw script tag must not appear; escaped version must
  assertEquals(html.includes("<script>alert"), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

// ─── buildFailureEmailHtml ────────────────────────────────────────────────────

Deno.test("buildFailureEmailHtml — contains date and error text", () => {
  const html = buildFailureEmailHtml("JIRA_API_TOKEN not set; GITHUB_READ_PAT not set", "2026-06-24");
  assertStringIncludes(html, "2026-06-24");
  assertStringIncludes(html, "JIRA_API_TOKEN not set");
  assertStringIncludes(html, "GITHUB_READ_PAT not set");
});

Deno.test("buildFailureEmailHtml — escapes HTML in error string", () => {
  const html = buildFailureEmailHtml("<error>bad</error>", "2026-06-24");
  assertEquals(html.includes("<error>"), false);
  assertStringIncludes(html, "&lt;error&gt;");
});

Deno.test("buildFailureEmailHtml — truncates very long errors", () => {
  const longError = "x".repeat(5000);
  const html = buildFailureEmailHtml(longError, "2026-06-24");
  // Pre should contain at most 1200 chars of the error
  assertEquals(html.includes("x".repeat(1201)), false);
});
