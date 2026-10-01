// Faraday Academy catalog — search, filtering and grouping. Pure functions.
//
// Copy rule carried in code: nothing here returns a count of anything. No
// "23 domains", no "99 courses", no per-filter tallies. The catalog renders
// groups and rows, never totals.

import type { CatalogCourse, CourseLevel } from "./types";

export const LEVELS: CourseLevel[] = ["101", "201", "301", "401", "X", "Capstone"];

/** Capstone always sorts last, whatever its domain name would do alphabetically. */
export const CAPSTONE_GROUP = "Capstone";

export type CatalogFilters = {
  search: string;
  levels: CourseLevel[];
  groups: string[];
  /** Author voice: "gil" | "mach". */
  authors: string[];
  narratedOnly: boolean;
};

export const EMPTY_FILTERS: CatalogFilters = {
  search: "",
  levels: [],
  groups: [],
  authors: [],
  narratedOnly: false,
};

export function hasActiveFilters(f: CatalogFilters): boolean {
  return (
    f.search.trim().length > 0 ||
    f.levels.length > 0 ||
    f.groups.length > 0 ||
    f.authors.length > 0 ||
    f.narratedOnly
  );
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Search spans title, group and author name. Course codes are never searchable. */
function matchesSearch(c: CatalogCourse, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = [c.title, c.group ?? "", c.author?.name ?? ""].join(" ").toLowerCase();
  // Every whitespace-separated term must appear, so "cooling water" narrows.
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function applyFilters(courses: CatalogCourse[], f: CatalogFilters): CatalogCourse[] {
  return courses.filter((c) => {
    if (!matchesSearch(c, f.search)) return false;
    if (f.levels.length > 0 && !f.levels.includes(c.level)) return false;
    if (f.groups.length > 0 && !(c.group && f.groups.includes(c.group))) return false;
    if (f.authors.length > 0 && !(c.author && f.authors.includes(c.author.voice))) return false;
    if (f.narratedOnly && !c.narrated) return false;
    return true;
  });
}

/** The distinct group names present, alphabetical, with Capstone last. */
export function groupNames(courses: CatalogCourse[]): string[] {
  const names = new Set<string>();
  for (const c of courses) if (c.group) names.add(c.group);
  const sorted = [...names].filter((n) => n !== CAPSTONE_GROUP).sort((a, b) => a.localeCompare(b));
  if (names.has(CAPSTONE_GROUP)) sorted.push(CAPSTONE_GROUP);
  return sorted;
}

/** The distinct author voices present, Gil before Mach. */
export function authorOptions(courses: CatalogCourse[]): Array<{ voice: string; name: string }> {
  const m = new Map<string, string>();
  for (const c of courses) if (c.author) m.set(c.author.voice, c.author.name);
  return [...m.entries()]
    .map(([voice, name]) => ({ voice, name }))
    .sort((a, b) => (a.voice === "gil" ? -1 : b.voice === "gil" ? 1 : a.voice.localeCompare(b.voice)));
}

/** The distinct levels present, in curriculum order. */
export function levelOptions(courses: CatalogCourse[]): CourseLevel[] {
  const present = new Set(courses.map((c) => c.level));
  return LEVELS.filter((l) => present.has(l));
}

export type CourseGroup = {
  name: string;
  courses: CatalogCourse[];
};

/**
 * Groups by plain domain name, Capstone last. Within a group, courses sort by
 * level in curriculum order, then title.
 */
export function groupCourses(courses: CatalogCourse[]): CourseGroup[] {
  const byName = new Map<string, CatalogCourse[]>();
  for (const c of courses) {
    const name = c.group ?? CAPSTONE_GROUP;
    const arr = byName.get(name) ?? [];
    arr.push(c);
    byName.set(name, arr);
  }
  const order = groupNames(courses.map((c) => ({ ...c, group: c.group ?? CAPSTONE_GROUP })));
  return order
    .filter((name) => byName.has(name))
    .map((name) => ({
      name,
      courses: (byName.get(name) ?? []).slice().sort((a, b) => {
        const d = LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level);
        return d !== 0 ? d : a.title.localeCompare(b.title);
      }),
    }));
}
