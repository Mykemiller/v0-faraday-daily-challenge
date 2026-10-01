"use client";
// Faraday Academy — the catalog.
//
// Search plus filters for level, domain name, author and narration. Grouped by
// plain domain name with Capstone last.
//
// Copy rule enforced here: no filter shows a count, and the page never states how
// many courses or domains exist. The result count is announced to screen readers
// only, as a live region — that is navigation feedback, not a public figure.

import { useMemo, useState } from "react";
import { CourseRow } from "./primitives";
import { EmptySearch } from "./states";
import {
  type CatalogFilters,
  EMPTY_FILTERS,
  applyFilters,
  authorOptions,
  groupCourses,
  groupNames,
  hasActiveFilters,
  levelOptions,
} from "@/lib/academy/catalog";
import type { Catalog, CourseLevel } from "@/lib/academy/types";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function FilterGroup({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mb-5">
      <legend className="academy-meta mb-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="px-2.5 py-1 text-sm"
      style={{
        border: `1px solid ${active ? "var(--ac-forest)" : "var(--ac-rule-strong)"}`,
        backgroundColor: active ? "var(--ac-forest)" : "transparent",
        color: active ? "var(--ac-bg)" : "var(--ac-text)",
      }}
    >
      {children}
    </button>
  );
}

export default function CatalogBrowser({ catalog }: { catalog: Catalog }) {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);

  const levels = useMemo(() => levelOptions(catalog.courses), [catalog.courses]);
  const groups = useMemo(() => groupNames(catalog.courses), [catalog.courses]);
  const authors = useMemo(() => authorOptions(catalog.courses), [catalog.courses]);

  const filtered = useMemo(() => applyFilters(catalog.courses, filters), [catalog.courses, filters]);
  const grouped = useMemo(() => groupCourses(filtered), [filtered]);

  return (
    <div className="lg:flex lg:gap-10">
      <div className="lg:w-64 lg:shrink-0">
        <label className="block">
          <span className="academy-meta mb-2 block">Search</span>
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.currentTarget.value }))}
            placeholder="Title, subject or author"
            className="w-full px-3 py-2 text-sm"
            style={{
              backgroundColor: "var(--ac-panel)",
              border: "1px solid var(--ac-rule-strong)",
              color: "var(--ac-text)",
            }}
          />
        </label>

        <div className="mt-6">
          <FilterGroup legend="Level">
            {levels.map((l) => (
              <Chip
                key={l}
                active={filters.levels.includes(l)}
                onClick={() => setFilters((f) => ({ ...f, levels: toggle<CourseLevel>(f.levels, l) }))}
              >
                {l}
              </Chip>
            ))}
          </FilterGroup>

          <FilterGroup legend="Subject">
            {groups.map((g) => (
              <Chip
                key={g}
                active={filters.groups.includes(g)}
                onClick={() => setFilters((f) => ({ ...f, groups: toggle(f.groups, g) }))}
              >
                {g}
              </Chip>
            ))}
          </FilterGroup>

          <FilterGroup legend="Author">
            {authors.map((a) => (
              <Chip
                key={a.voice}
                active={filters.authors.includes(a.voice)}
                onClick={() => setFilters((f) => ({ ...f, authors: toggle(f.authors, a.voice) }))}
              >
                {a.name}
              </Chip>
            ))}
          </FilterGroup>

          <FilterGroup legend="Narration">
            <Chip
              active={filters.narratedOnly}
              onClick={() => setFilters((f) => ({ ...f, narratedOnly: !f.narratedOnly }))}
            >
              Narrated
            </Chip>
          </FilterGroup>

          {hasActiveFilters(filters) ? (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-sm underline"
              style={{ color: "var(--ac-accent-text)" }}
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-8 flex-1 lg:mt-0">
        {/* Navigation feedback for screen readers; never rendered as a public figure. */}
        <p role="status" className="sr-only">
          {filtered.length === 1 ? "1 course matches" : `${filtered.length} courses match`}
        </p>

        {filtered.length === 0 ? (
          <EmptySearch onReset={() => setFilters(EMPTY_FILTERS)} />
        ) : (
          grouped.map((group) => (
            <section key={group.name} className="mb-10" aria-labelledby={`group-${group.name}`}>
              <h2
                id={`group-${group.name}`}
                className="font-serif text-xl font-bold"
                style={{ color: "var(--ac-text)" }}
              >
                {group.name}
              </h2>
              <div
                className="mt-1 mb-3"
                aria-hidden="true"
                style={{ height: 2, width: 56, backgroundColor: "var(--ac-accent)" }}
              />
              <ul style={{ borderTop: "1px solid var(--ac-rule)" }}>
                {group.courses.map((c) => (
                  <CourseRow key={c.slug} course={c} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
