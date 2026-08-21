-- CC-DC-GAME-REGISTRY-1.0 · Phase 3 — the two functions read the catalog (D5/D6)
--
-- AC3: neither function body contains any of the seven display names or any of
-- the seven Public ID prefixes after this migration.

begin;

-- ── Deploy safety: fill game_id for writers that don't send it yet ──────────
-- dc_puzzle_bank_staging.game_id became NOT NULL in Phase 2, but the app that
-- writes it deploys separately and later. Without this, any generation run in
-- the gap fails with a NOT NULL violation. Named to sort BEFORE
-- trg_dc_assign_public_id: Postgres fires same-event triggers in NAME order,
-- and the public-id trigger depends on game_id already being resolved.
create or replace function public.dc_fill_game_id()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.game_id is null and new.puzzle_type is not null then
    select id into new.game_id from game_catalog where display_name = new.puzzle_type;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_dc_00_fill_game_id on public.dc_puzzle_bank_staging;
create trigger trg_dc_00_fill_game_id
  before insert or update on public.dc_puzzle_bank_staging
  for each row execute function public.dc_fill_game_id();

-- ── D5: prefix comes from the catalog. Format + sequence UNCHANGED. ─────────
create or replace function public.dc_assign_public_id()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_prefix text;
  v_name   text;
  v_n      bigint;
begin
  if new.public_id is not null then
    return new;
  end if;
  if new.published not in ('Published', 'Live', 'Retired') then
    return new;
  end if;

  if new.game_id is null then
    raise exception 'dc_assign_public_id: row % has no game_id — it could not be resolved from puzzle_type "%"',
      new.id, new.puzzle_type;
  end if;

  select public_id_prefix, display_name
    into v_prefix, v_name
    from game_catalog
   where id = new.game_id;

  if v_name is null then
    raise exception 'dc_assign_public_id: row % references game_catalog id % which does not exist',
      new.id, new.game_id;
  end if;

  -- Still raises when the prefix is null (A5) — but now it names the game and
  -- says what to fix, instead of reporting an "unknown puzzle_type".
  if v_prefix is null then
    raise exception 'dc_assign_public_id: game "%" cannot be published — its game_catalog row is incomplete (public_id_prefix is null). Set a four-letter prefix on the catalog row.',
      v_name;
  end if;

  if new.go_live_date is null then
    raise exception 'dc_assign_public_id: go_live_date is required to publish row %', new.id;
  end if;

  v_n := nextval('public.dc_public_id_seq');
  new.public_id := v_prefix || '-' || to_char(new.go_live_date, 'YY-MM-DD') || '-' || lpad(v_n::text, 5, '0');
  return new;
end
$function$;

-- ── D6: expected games come from a query, not a literal ────────────────────
--
-- Two changes beyond dropping c_types:
--
-- 1. The expected set is now `game_catalog where lifecycle_state='live'`
--    (platform-wide; the season-scoped signature is CC-DC-SEASON-SCOPED-BANK-1.0).
--
-- 2. ⚠️ BUG FIX (Myke-approved, Phase 3). `live_types` was derived ONLY from the
--    rows this invocation promoted, so a SECOND run on the same day promoted
--    nothing and reported ALL games missing — a false alarm on every re-run.
--    It now reports what is ACTUALLY Live for p_today, which makes the function
--    idempotent in its reporting as well as its writes.
--
-- Types are reported as game_catalog.runtime_key — the key the serving path
-- joins on (D3). Identical to display_name today.
create or replace function public.fn_dc_rotate_live_set(p_today date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_promoted_ids   text[] := '{}';
  v_promoted_types text[] := '{}';
  v_retired_ids    text[] := '{}';
  v_live_types     text[] := '{}';
  v_missing_types  text[] := '{}';
begin
  with promoted as (
    update dc_puzzle_bank_staging
       set published = 'Live'
     where published = 'Published'
       and go_live_date = p_today
    returning id, game_id
  )
  select coalesce(array_agg(p.id::text), '{}'),
         coalesce(array_agg(g.runtime_key), '{}')
    into v_promoted_ids, v_promoted_types
    from promoted p
    join game_catalog g on g.id = p.game_id;

  with retired as (
    update dc_puzzle_bank_staging
       set published = 'Retired'
     where published = 'Live'
       and go_live_date < p_today
    returning id
  )
  select coalesce(array_agg(id::text), '{}')
    into v_retired_ids
    from retired;

  -- What is actually serving for p_today (not merely what this call promoted).
  select coalesce(array_agg(distinct g.runtime_key), '{}')
    into v_live_types
    from dc_puzzle_bank_staging s
    join game_catalog g on g.id = s.game_id
   where s.published = 'Live'
     and s.go_live_date = p_today;

  -- Expected = the platform-wide live set, from the catalog.
  select coalesce(array_agg(g.runtime_key order by g.lobby_sort_order, g.display_name), '{}')
    into v_missing_types
    from game_catalog g
   where g.lifecycle_state = 'live'
     and not (g.runtime_key = any(v_live_types));

  return jsonb_build_object(
    'promoted',      coalesce(array_length(v_promoted_ids, 1), 0),
    'retired',       coalesce(array_length(v_retired_ids, 1), 0),
    'promoted_ids',  to_jsonb(v_promoted_ids),
    'retired_ids',   to_jsonb(v_retired_ids),
    'live_types',    to_jsonb(v_live_types),
    'missing_types', to_jsonb(v_missing_types)
  );
end
$function$;

-- ── AC3 assertion: no game name or prefix survives in either body ───────────
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('dc_assign_public_id', 'fn_dc_rotate_live_set')
     and p.prosrc ~ '(Rackl|Signal Drop|The Stack|Circuit|The Brief|Dark Fiber|Frequency|RACK|SGNL|STAK|CIRC|BRIF|FIBR|FREQ)';
  if bad is not null then
    raise exception 'AC3 violated: hardcoded game identity remains in %', bad;
  end if;
end $$;

commit;
