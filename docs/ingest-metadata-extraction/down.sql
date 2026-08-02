-- CC-INGEST-METADATA-EXTRACTION-1.0 — down-migration (NOT applied; keep for
-- rollback readiness). Reverses both backfill parts precisely: keys are
-- removed ONLY where their value equals what the backfill would have written,
-- so pre-existing metadata (legacy rows, the 51 tail rows that already carried
-- a summary) is never stripped. Legacy rows are additionally excluded
-- structurally: they have no source_name key (verified overlap = 0 rows).

-- Part 2 down: stub titles
update public.artifacts a
set signal_envelope = a.signal_envelope - 'title'
where a.signal_envelope->>'source_name' like 'Google News search:%'
  and a.signal_envelope->>'title' = btrim(split_part(a.raw_content, E'\n', 1));

-- Part 1 down, step 1: summaries (only where equal to the extraction)
update public.artifacts a
set signal_envelope = a.signal_envelope - 'summary'
where coalesce(a.signal_envelope->>'source_name','') <> ''
  and a.signal_envelope->>'source_name' not like 'Google News search:%'
  and position(E'\n\n' in a.raw_content) > 0
  and a.signal_envelope->>'summary' = btrim(substring(a.raw_content from position(E'\n\n' in a.raw_content) + 2));

-- Part 1 down, step 2: titles (only where equal to the extraction)
update public.artifacts a
set signal_envelope = a.signal_envelope - 'title'
where coalesce(a.signal_envelope->>'source_name','') <> ''
  and a.signal_envelope->>'source_name' not like 'Google News search:%'
  and a.signal_envelope->>'title' = btrim(split_part(a.raw_content, E'\n', 1));

-- Part 1 down, step 3: sources (only where equal to source_name)
update public.artifacts a
set signal_envelope = a.signal_envelope - 'source'
where coalesce(a.signal_envelope->>'source_name','') <> ''
  and a.signal_envelope->>'source_name' not like 'Google News search:%'
  and a.signal_envelope->>'source' = a.signal_envelope->>'source_name';
