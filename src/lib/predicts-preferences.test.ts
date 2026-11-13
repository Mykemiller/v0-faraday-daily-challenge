// node --test src/lib/predicts-preferences.test.ts  (FDY-119)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COPY, COUNT_PHRASE_RE, clampInt, filterNamed, formatDate, formatProbability, preferencesUrlFrom,
  sameDocument, toDocument, toggle, type Prefs,
} from "./predicts-preferences.ts";

const base: Prefs = {
  version: 1, sectors: [], theaters: [], threads: [], key_players: [], horizons: [], min_probability: 60, include_bold: true,
  frequency: "daily", weekly_dow: 1, channels: { email: true, sms: false, slack: false, teams: false }, quiet_hours: null, tone_level: 7, persona_key: "house",
};

test("dates are formatted from string parts, never shifted", () => {
  assert.equal(formatDate("2026-12-10"), "Dec 10, 2026");
  assert.equal(formatDate("2027-01-01"), "Jan 1, 2027");
  assert.equal(formatDate(null), null);
  assert.equal(formatDate("2026-13-01"), null);
  assert.equal(formatDate("2026-12-10T00:00:00Z"), null);
});

test("a null probability never renders as 0", () => {
  assert.equal(formatProbability(null), "—");
  assert.equal(formatProbability(undefined), "—");
  assert.equal(formatProbability(71.6), "72%");
  assert.equal(formatProbability(0), "0%");
});

test("toDocument always sends unavailable channels as false and empty quiet hours as null", () => {
  const d = toDocument({ ...base, channels: { email: false, sms: true, slack: true, teams: true }, quiet_hours: { start: "22:00", end: "" } });
  assert.deepEqual(d.channels, { email: false, sms: false, slack: false, teams: false });
  assert.equal(d.quiet_hours, null);
  assert.deepEqual(toDocument({ ...base, quiet_hours: { start: "22:00", end: "06:30" } }).quiet_hours, { start: "22:00", end: "06:30" });
});

test("helpers", () => {
  assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
  assert.deepEqual(toggle(["a"], "c"), ["a", "c"]);
  assert.equal(clampInt("140", 1, 99), 99);
  assert.equal(clampInt("", 1, 99), null);
  assert.equal(clampInt("abc", 1, 99), null);
  assert.ok(sameDocument(base, { ...base }));
  assert.ok(!sameDocument(base, { ...base, min_probability: 61 }));
  assert.equal(preferencesUrlFrom("https://x.supabase.co/functions/v1/predicts-public"), "https://x.supabase.co/functions/v1/predicts-preferences");
  assert.deepEqual(filterNamed([{ name: "Grid Power" }, { name: "Cooling" }], "grid").length, 1);
});

test("IDF §06: no count of Theaters, Sectors or Threads and no 'selected' badge in the page source or copy", () => {
  const src = ["../app/predicts/preferences/Configurator.tsx", "../app/predicts/preferences/page.tsx", "./predicts-preferences.ts"]
    .map((p) => readFileSync(new URL(p, import.meta.url), "utf8")).join("\n");
  assert.ok(!COUNT_PHRASE_RE.test(src));
  assert.ok(!/\bselected\b/i.test(src.replace(/aria-selected|selected_key_players|\/\/.*$/gm, "")), "a 'selected' badge appears in the page");
  for (const v of Object.values(COPY)) assert.ok(!COUNT_PHRASE_RE.test(v));
  assert.ok(!/\.length\}?\s*(sectors|theaters|threads)/i.test(src));
});
