-- CC-DC-GAME-REGISTRY-1.0 · Phase 1 — catalog integrity + authoritative per-game columns
--
-- `game_catalog` becomes the single source of truth for a game's identity and
-- presentation. Everything seeded here is transcribed VERBATIM from the code
-- registries it replaces, so Phase 4 is a pure de-hardcoding with no visual or
-- copy change:
--
--   route_slug ......... src/lib/share/manifest.js SLUG_BY_TYPE == GameIcon.jsx GAME_SLUG
--                        (share icon path is derived: /share/icons/{slug}.png)
--   accent_* ........... src/lib/game-accent.js GAME_ACCENT
--   lobby_* ............ DailyChallenge.jsx GAME_CONFIGS
--   par_seconds ........ src/lib/market-reaction.ts PAR_TIMES (seed fallback)
--   take_voice ......... src/lib/faradays-take.ts TAKE_VOICE_BY_TYPE
--   grid_fit ........... src/lib/dc-ui/grid.ts SQUARE_GRID_FIT
--   signal_enabled ..... DailyChallenge.jsx SIGNAL_ENABLED_GAMES
--   is_core ............ supabase/functions/complete-puzzle CORE_PUZZLE_TYPES
--   share_epoch ........ src/lib/share/manifest.js SHARE_EPOCH (pinned, never derived)
--
-- ⚠️ TWO ORDERINGS, deliberately kept apart. `sort_order` is the League Office
-- catalog order (The Brief first). `lobby_sort_order` is the player-facing LOCKED
-- tile order that front-loads quick-momentum games (Rackl first). They have never
-- matched; collapsing them would silently reorder one surface or the other.
--
-- ⚠️ `description` (League Office copy) is NOT `lobby_description` (tile copy).
-- Different strings today; both preserved.

begin;

-- ── D4: publishability constraints ──────────────────────────────────────────
alter table public.game_catalog
  add constraint game_catalog_public_id_prefix_key unique (public_id_prefix);

alter table public.game_catalog
  add constraint game_catalog_public_id_prefix_shape
  check (public_id_prefix is null or public_id_prefix ~ '^[A-Z]{4}$');

-- Supersedes game_catalog_live_needs_runtime_key: a live game must carry every
-- field the publish path needs, not just the runtime key. new_idea / in_test /
-- retired rows are untouched by the implication.
alter table public.game_catalog
  drop constraint if exists game_catalog_live_needs_runtime_key;

alter table public.game_catalog
  add constraint game_catalog_live_is_publishable
  check (
    lifecycle_state <> 'live'
    or (public_id_prefix is not null and short_code is not null and runtime_key is not null)
  );

-- ── D7: derived publishability, read by every picker ────────────────────────
alter table public.game_catalog
  add column is_publishable boolean
  generated always as (
    public_id_prefix is not null and short_code is not null and runtime_key is not null
  ) stored;

comment on column public.game_catalog.is_publishable is
  'DERIVED (D7). True when the row can mint a Public ID and be served. Pickers filter on this; the missing-field reason is composed app-side from the same three columns.';

-- ── Authoritative per-game columns ──────────────────────────────────────────
alter table public.game_catalog
  add column route_slug          text,
  add column accent_hex          text,
  add column accent_deep_hex     text,
  add column accent_glow_rgba    text,
  add column lobby_sort_order    integer,
  add column lobby_description   text,
  add column lobby_time_estimate text,
  add column lobby_format_chip   text,
  add column par_seconds         integer,
  add column take_voice          text,
  add column grid_fit            text,
  add column signal_enabled      boolean not null default false,
  add column is_core             boolean not null default false,
  add column share_epoch         date;

alter table public.game_catalog
  add constraint game_catalog_route_slug_key unique (route_slug),
  add constraint game_catalog_route_slug_shape
    check (route_slug is null or route_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint game_catalog_accent_hex_shape
    check (accent_hex is null or accent_hex ~ '^#[0-9A-F]{6}$'),
  add constraint game_catalog_accent_deep_hex_shape
    check (accent_deep_hex is null or accent_deep_hex ~ '^#[0-9A-F]{6}$'),
  add constraint game_catalog_grid_fit_shape
    check (grid_fit is null or grid_fit in ('square','fluid','list','prose')),
  add constraint game_catalog_par_seconds_positive
    check (par_seconds is null or par_seconds > 0);

comment on column public.game_catalog.route_slug is
  'URL/asset slug. Share route + icon filename both derive from it (/share/icons/{route_slug}.png).';
comment on column public.game_catalog.lobby_sort_order is
  'Player-facing LOCKED lobby tile order. Distinct from sort_order (League Office catalog order) — see migration header.';
comment on column public.game_catalog.is_core is
  'Member of the core set whose completion awards the full-set streak (complete-puzzle). Counted, never compared to a literal.';
comment on column public.game_catalog.share_epoch is
  'PINNED day #1 for this game''s share numbering. Never derived at runtime — recomputing it would renumber every share already in the wild.';

-- ── Seed the 7 live games, verbatim from code ───────────────────────────────
update public.game_catalog as g set
  route_slug          = v.route_slug,
  accent_hex          = v.accent_hex,
  accent_deep_hex     = v.accent_deep_hex,
  accent_glow_rgba    = v.accent_glow_rgba,
  lobby_sort_order    = v.lobby_sort_order,
  lobby_description   = v.lobby_description,
  lobby_time_estimate = v.lobby_time_estimate,
  lobby_format_chip   = v.lobby_format_chip,
  par_seconds         = v.par_seconds,
  take_voice          = v.take_voice,
  grid_fit            = v.grid_fit,
  signal_enabled      = v.signal_enabled,
  is_core             = v.is_core,
  share_epoch         = v.share_epoch
from (values
  ('rackl',       'Rackl',       '#48FF54','#38C742','rgba(72,255,84,.28)',   10,'Group the tiles — four connected sets','~3 min','Connect', 90,'Gilbert Faraday','fluid',false,true, date '2026-06-24'),
  ('circuit',     'Circuit',     '#48FEFE','#38C6C6','rgba(72,254,254,.28)',  20,'True/False sprint — beat the clock',    '~2 min','Sprint', 120,'Mach Eigen',    'fluid',false,true, date '2026-06-24'),
  ('dark-fiber',  'Dark Fiber',  '#A855FF','#8342C7','rgba(168,85,255,.28)',  30,'Match terms to their definitions',      '~3 min','Match',   90,'Gilbert Faraday','fluid',false,true, date '2026-06-24'),
  ('frequency',   'Frequency',   '#FF7C52','#C76140','rgba(255,124,82,.28)',  40,'Multiple choice knowledge quiz',        '~3 min','Quiz',    60,'Gilbert Faraday','list', false,false,date '2026-06-24'),
  ('the-stack',   'The Stack',   '#D6FF18','#A7C713','rgba(214,255,24,.28)',  50,'Drag to rank in the correct order',     '~2 min','Rank',    75,'Gilbert Faraday','list', false,true, date '2026-06-24'),
  ('signal-drop', 'Signal Drop', '#FF6B7D','#C75361','rgba(255,107,125,.28)', 60,'Guess the industry term — Wordle style','~2 min','Guess',   60,'Mach Eigen',    'fluid',false,false,date '2026-06-24'),
  ('the-brief',   'The Brief',   '#F58CF5','#BF6DBF','rgba(245,140,245,.28)', 70,'Read the intelligence brief, then answer','~4 min','Read',  150,'Mach Eigen',    'prose',true, false,date '2026-06-24')
) as v(route_slug, display_name, accent_hex, accent_deep_hex, accent_glow_rgba, lobby_sort_order,
       lobby_description, lobby_time_estimate, lobby_format_chip, par_seconds, take_voice,
       grid_fit, signal_enabled, is_core, share_epoch)
where g.display_name = v.display_name;

-- ── In-transaction assertions ───────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.game_catalog where lifecycle_state='live';
  if n <> 7 then raise exception 'expected 7 live games, found %', n; end if;

  select count(*) into n from public.game_catalog
   where lifecycle_state='live' and not is_publishable;
  if n <> 0 then raise exception 'AC1 violated: % live rows are not publishable', n; end if;

  select count(*) into n from public.game_catalog
   where lifecycle_state='live'
     and (route_slug is null or accent_hex is null or lobby_sort_order is null
          or lobby_description is null or par_seconds is null or take_voice is null
          or grid_fit is null or share_epoch is null);
  if n <> 0 then raise exception '% live rows have unseeded catalog columns', n; end if;

  select count(*) into n from public.game_catalog where is_core;
  if n <> 4 then raise exception 'expected 4 core games, found %', n; end if;

  select count(*) into n from public.game_catalog where signal_enabled;
  if n <> 1 then raise exception 'expected 1 signal-enabled game, found %', n; end if;

  -- D8: the 11 new_idea rows stay untouched and unpublishable.
  select count(*) into n from public.game_catalog
   where lifecycle_state='new_idea' and is_publishable;
  if n <> 0 then raise exception 'D8 violated: % new_idea rows became publishable', n; end if;

  select count(*) into n from public.game_catalog where lifecycle_state='new_idea';
  if n <> 11 then raise exception 'expected 11 new_idea games, found %', n; end if;
end $$;

commit;
