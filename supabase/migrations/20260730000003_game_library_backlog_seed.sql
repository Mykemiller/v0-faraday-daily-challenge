-- CC-LO-GAME-LIBRARY-1.0 · Phase 2 — seed the 11 backlog concepts (D7)
--
-- Source: Notion "Puzzling Brainstorming", verified 2026-07-25. This turns that
-- table into managed data so the backlog lives in the Game Library rather than a
-- document nobody queries.
--
-- Every row lands as new_idea / is_active=false / runtime_key=null:
--   • runtime_key stays NULL because no serving string exists yet — a concept has
--     no puzzle bank. The Phase 1 CHECK only demands one for `live`.
--   • is_active=false keeps them out of loadGameCatalog()'s default filter, so the
--     shipped season slate editor (`?all=1` omitted) does NOT show them.
--   • the D9 trigger independently blocks assigning any of them to a season.
--   • short_code stays NULL — it is a separate live system from the public-ID
--     prefixes and must never be derived (D8).
--
-- `category` uses the existing vocabulary (word / logic / data / editorial) plus
-- one NEW value, `spatial`, for Grid Lock and Mesh. Verified 2026-07-30: there is
-- NO check constraint on game_catalog.category (only PK(id) + UNIQUE(game_key)),
-- so nothing needs extending — the appendix's conditional does not apply.
--
-- Idempotent via ON CONFLICT (game_key) DO NOTHING: re-running never duplicates
-- and never overwrites a row staff have since edited.

begin;

insert into game_catalog
  (game_key, display_name, category, description, lifecycle_state,
   is_active, is_beta, runtime_key, short_code, sort_order, idea_source, metadata)
values
  ('patch_notes',  'Patch Notes',  'word',      'Fill-in-the-blank using tech/company jargon, Mad Libs style',                     'new_idea', false, false, null, null, 1000, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','word',      'description','Fill-in-the-blank using tech/company jargon, Mad Libs style',                     'icon_concept','Sticky note with a redacted blank line',    'source','Notion — Puzzling Brainstorming')),
  ('handshake',    'Handshake',    'word',      'Pair up related terms, Connections-style matching',                               'new_idea', false, false, null, null, 1010, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','word',      'description','Pair up related terms, Connections-style matching',                               'icon_concept','Two overlapping puzzle-piece hands',        'source','Notion — Puzzling Brainstorming')),
  ('latency',      'Latency',      'word',      'Guess-the-word with delayed/partial letter reveals',                              'new_idea', false, false, null, null, 1020, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','word',      'description','Guess-the-word with delayed/partial letter reveals',                              'icon_concept','Clock with a lagging second hand',          'source','Notion — Puzzling Brainstorming')),
  ('failover',     'Failover',     'logic',     'Elimination-style logic puzzle (Mastermind-like), guess a hidden sequence',       'new_idea', false, false, null, null, 1030, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','logic',     'description','Elimination-style logic puzzle (Mastermind-like), guess a hidden sequence',       'icon_concept','Branching switch/toggle diagram',           'source','Notion — Puzzling Brainstorming')),
  ('uptime',       'Uptime',       'logic',     'Daily sequencing puzzle — order events/steps correctly to keep a streak alive',   'new_idea', false, false, null, null, 1040, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','logic',     'description','Daily sequencing puzzle — order events/steps correctly to keep a streak alive',   'icon_concept','Ascending green uptime graph line',         'source','Notion — Puzzling Brainstorming')),
  ('load_balance', 'Load Balance', 'data',      'Distribute numeric values to hit a target, mini balancing game',                  'new_idea', false, false, null, null, 1050, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','data',      'description','Distribute numeric values to hit a target, mini balancing game',                  'icon_concept','Balance scale with weighted nodes',         'source','Notion — Puzzling Brainstorming')),
  ('bandwidth',    'Bandwidth',    'data',      'Daily numeric range-guessing game, Wordle-for-numbers',                           'new_idea', false, false, null, null, 1060, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','data',      'description','Daily numeric range-guessing game, Wordle-for-numbers',                           'icon_concept','Signal bars filling a gauge',               'source','Notion — Puzzling Brainstorming')),
  ('grid_lock',    'Grid Lock',    'spatial',   'Spatial / tile-sliding puzzle',                                                   'new_idea', false, false, null, null, 1070, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','spatial',   'description','Spatial / tile-sliding puzzle',                                                   'icon_concept','Scrambled grid of squares',                 'source','Notion — Puzzling Brainstorming')),
  ('mesh',         'Mesh',         'spatial',   'Network-topology connect-the-dots — draw one line touching all nodes',            'new_idea', false, false, null, null, 1080, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','spatial',   'description','Network-topology connect-the-dots — draw one line touching all nodes',            'icon_concept','Connected dot-and-line network',            'source','Notion — Puzzling Brainstorming')),
  ('cold_start',   'Cold Start',   'editorial', 'Daily trivia with a twist, can tie into that day''s Brief content',               'new_idea', false, false, null, null, 1090, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','editorial', 'description','Daily trivia with a twist, can tie into that day''s Brief content',               'icon_concept','Power button with a spark',                 'source','Notion — Puzzling Brainstorming')),
  ('root_cause',   'Root Cause',   'editorial', '"What caused this outage" mystery/deduction using clues',                         'new_idea', false, false, null, null, 1100, 'Notion — Puzzling Brainstorming (verified 2026-07-25)', jsonb_build_object('category','editorial', 'description','"What caused this outage" mystery/deduction using clues',                         'icon_concept','Magnifying glass over a server rack',       'source','Notion — Puzzling Brainstorming'))
on conflict (game_key) do nothing;

-- ── Verification gate ────────────────────────────────────────────────────────
-- 18 catalog rows (7 live + 11 new_idea), and season_games STILL 28 — seeding a
-- concept must never create an assignment.
do $$
declare g int; sg int; live int; idea int;
begin
  select count(*) into g    from game_catalog;
  select count(*) into sg   from season_games;
  select count(*) into live from game_catalog where lifecycle_state = 'live';
  select count(*) into idea from game_catalog where lifecycle_state = 'new_idea';
  if g <> 18 or sg <> 28 or live <> 7 or idea <> 11 then
    raise exception
      'VERIFICATION FAILED — expected catalog=18 (7 live / 11 new_idea) and season_games=28, got catalog=% (live=% new_idea=%) season_games=%. Rolling back.',
      g, live, idea, sg;
  end if;
end $$;

commit;
