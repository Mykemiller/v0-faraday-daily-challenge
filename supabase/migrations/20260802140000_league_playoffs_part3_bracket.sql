-- League Playoffs — Part 3: seeding + single-elimination bracket
-- CC-LEAGUE-PLAYOFFS-1.0 · claude/league-playoffs-implementation-b78mg6
--
-- Snapshots the qualifying field from REGULAR-season standings, builds a
-- single-elimination bracket, and settles it from real playoff-window
-- score_events. Nothing here fabricates an outcome: a matchup is decided only
-- once its round's window has CLOSED, and only by points already earned.
--
-- ADDITIVE. Four new tables + three functions; no existing object is modified.
-- Depends on fn_season_phase_window() from Part 2 (20260802130000).
-- Down: docs/league-playoffs/part3-down.sql.
--
-- RLS: all four tables are RLS-ON with ZERO POLICIES (deny-all), like every
-- other dc_* table. DC players hold no Supabase JWT — identity is the custom
-- dc_sessions token — so an auth.uid() policy could never fire, and an anon
-- SELECT policy would expose a bracket before the commissioner publishes it.
-- Reads are server-side service-role only. NEVER add an anon policy.
--
-- The structural rules (seed order, byes, round windows, tie-breaks) are
-- mirrored in src/lib/league-playoffs/bracket.ts and pinned by
-- `npm run test:playoffs`. Keep the two in sync.

begin;

-- ── config: per-season, commissioner-owned ──────────────────────────────────
create table if not exists public.dc_playoff_config (
  season_id        uuid primary key references public.seasons(id) on delete cascade,
  format           text not null default 'single_elim',
  participant_kind text not null default 'team',
  qualifier_count  int  not null default 8,
  seeding_source   text not null default 'regular',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  constraint dc_playoff_config_format_ck check (format in ('single_elim')),
  constraint dc_playoff_config_kind_ck   check (participant_kind in ('team', 'player')),
  -- 2 is the smallest real bracket; 64 is a sanity ceiling, not a product limit.
  constraint dc_playoff_config_qualifiers_ck check (qualifier_count between 2 and 64),
  -- Seeds come from the REGULAR window by default. 'full' exists for a league
  -- that wants whole-season seeding; it never means "including playoff points
  -- already scored", because seeding happens before the window opens.
  constraint dc_playoff_config_seeding_ck check (seeding_source in ('regular', 'full'))
);

comment on table public.dc_playoff_config is
  'Per-season playoff format. v1 = single elimination by seed; participant_kind '
  'selects a team or player bracket. RLS deny-all, service-role reads only.';

-- ── bracket: one per season, snapshotted at seed time ───────────────────────
create table if not exists public.dc_playoff_brackets (
  id                  uuid primary key default gen_random_uuid(),
  season_id           uuid not null references public.seasons(id) on delete cascade,
  -- Config is COPIED here, not referenced: editing config later must never
  -- silently reinterpret a bracket that has already been seeded and played.
  format              text not null,
  participant_kind    text not null,
  qualifier_count     int  not null,
  rounds              int  not null,
  seeding_window_from date not null,
  seeding_window_to   date not null,
  playoff_window_from date not null,
  playoff_window_to   date not null,
  status              text not null default 'seeded',
  seeded_at           timestamptz not null default now(),
  seeded_by           text,
  champion_participant_id uuid,
  constraint dc_playoff_brackets_status_ck check (status in ('seeded', 'final')),
  constraint dc_playoff_brackets_rounds_ck check (rounds between 1 and 6),
  constraint dc_playoff_brackets_seed_window_ck check (seeding_window_to >= seeding_window_from),
  constraint dc_playoff_brackets_play_window_ck check (playoff_window_to >= playoff_window_from)
);

-- One bracket per season. Re-seeding REPLACES it (fn_playoff_seed_field deletes
-- first); the history of who re-seeded and why lives in lo_audit_log.
create unique index if not exists dc_playoff_brackets_one_per_season
  on public.dc_playoff_brackets (season_id);

-- ── seeds: the snapshot of who qualified, and on what ───────────────────────
create table if not exists public.dc_playoff_seeds (
  bracket_id     uuid not null references public.dc_playoff_brackets(id) on delete cascade,
  seed           int  not null,
  participant_id uuid not null,
  -- Snapshotted so a later rename cannot rewrite the bracket's history.
  display_name   text not null,
  seed_points    bigint not null,
  primary key (bracket_id, seed),
  constraint dc_playoff_seeds_seed_ck check (seed >= 1)
);

create unique index if not exists dc_playoff_seeds_unique_participant
  on public.dc_playoff_seeds (bracket_id, participant_id);

-- ── matchups: the tree, plus each side's derived points ─────────────────────
create table if not exists public.dc_playoff_matchups (
  id                    uuid primary key default gen_random_uuid(),
  bracket_id            uuid not null references public.dc_playoff_brackets(id) on delete cascade,
  round                 int  not null,
  slot                  int  not null,
  seed_a                int,
  seed_b                int,
  participant_a         uuid,
  participant_b         uuid,
  -- Points earned INSIDE this round's window. Recomputed, never hand-written.
  points_a              bigint,
  points_b              bigint,
  winner_participant_id uuid,
  decided_at            timestamptz,
  decided_reason        text,
  round_starts_on       date not null,
  round_ends_on         date not null,
  next_matchup_id       uuid references public.dc_playoff_matchups(id) on delete set null,
  next_side             text,
  constraint dc_playoff_matchups_round_ck check (round >= 1),
  constraint dc_playoff_matchups_slot_ck  check (slot >= 0),
  constraint dc_playoff_matchups_side_ck  check (next_side is null or next_side in ('a','b')),
  constraint dc_playoff_matchups_window_ck check (round_ends_on >= round_starts_on),
  constraint dc_playoff_matchups_reason_ck
    check (decided_reason is null or decided_reason in ('bye','points','seed_tiebreak')),
  -- A decided matchup must name its winner, and vice versa.
  constraint dc_playoff_matchups_decided_ck
    check ((winner_participant_id is null) = (decided_at is null))
);

create unique index if not exists dc_playoff_matchups_unique_slot
  on public.dc_playoff_matchups (bracket_id, round, slot);
create index if not exists dc_playoff_matchups_bracket_round
  on public.dc_playoff_matchups (bracket_id, round);

-- ── RLS: on, deny-all, zero policies ────────────────────────────────────────
alter table public.dc_playoff_config    enable row level security;
alter table public.dc_playoff_brackets  enable row level security;
alter table public.dc_playoff_seeds     enable row level security;
alter table public.dc_playoff_matchups  enable row level security;

-- ── per-participant points inside an arbitrary window ───────────────────────
-- Defined FIRST because fn_playoff_recompute calls it.
-- Team → sum over its season roster; player → that subscriber's own events.
-- Returns NULL for a null participant (an unfilled bracket slot), which is
-- distinct from 0 (played, scored nothing).
create or replace function public.fn_playoff_participant_points(
  p_season_id uuid,
  p_kind text,
  p_participant_id uuid,
  p_from date,
  p_to date
)
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when p_participant_id is null then null
    when p_kind = 'team' then (
      select coalesce(sum(se.points), 0)::bigint
        from public.team_memberships tm
        join public.dc_subscribers s on s.id = tm.subscriber_id
        join public.score_events se on se.subscriber_id = tm.subscriber_id
         and se.played_at::date between p_from and p_to
       where tm.team_id = p_participant_id
         and tm.season_id = p_season_id
         and tm.pending = false
         and s.active = true)
    else (
      select coalesce(sum(se.points), 0)::bigint
        from public.score_events se
        join public.dc_subscribers s on s.id = se.subscriber_id
       where se.subscriber_id = p_participant_id
         and s.active = true
         and se.played_at::date between p_from and p_to)
  end;
$function$;

-- ── recompute ───────────────────────────────────────────────────────────────
-- Walks rounds in order, sums each side's points inside that round's window from
-- REAL score_events, decides only CLOSED rounds, propagates winners forward.
-- Idempotent: the guarded UPDATE means a no-change run writes nothing.
create or replace function public.fn_playoff_recompute(p_bracket_id uuid)
returns int
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_b       public.dc_playoff_brackets;
  v_m       public.dc_playoff_matchups;
  v_today   date;
  v_tz      text;
  v_closed  boolean;
  v_pa      bigint;
  v_pb      bigint;
  v_winner  uuid;
  v_reason  text;
  v_changed int := 0;
  v_champ   uuid;
  v_r       int;
begin
  select * into v_b from public.dc_playoff_brackets where id = p_bracket_id;
  if not found then return 0; end if;

  select s.tz into v_tz from public.seasons s where s.id = v_b.season_id;
  begin
    v_today := (now() at time zone coalesce(v_tz, 'America/Chicago'))::date;
  exception when others then
    v_today := (now() at time zone 'America/Chicago')::date;
  end;

  -- ⚠️ Iterate ROUND BY ROUND, with a fresh query per round — NOT one cursor
  -- over every matchup ordered by (round, slot).
  --
  -- A single cursor snapshots its rows up front, so a round-2 row would be read
  -- with participant_a still NULL even after round 1 propagated a winner into
  -- it. Its points would then be computed against an empty slot and cached as
  -- NULL while the table said otherwise — the cached value would disagree with
  -- a fresh recomputation until some later run happened to fix it. Opening the
  -- query for round r only after round r−1 has finished writing is what makes
  -- one pass sufficient and the result self-consistent.
  for v_r in 1..v_b.rounds loop
  for v_m in
    select * from public.dc_playoff_matchups
     where bracket_id = p_bracket_id and round = v_r order by slot
  loop
    v_pa := public.fn_playoff_participant_points(
              v_b.season_id, v_b.participant_kind, v_m.participant_a,
              v_m.round_starts_on, v_m.round_ends_on);
    v_pb := public.fn_playoff_participant_points(
              v_b.season_id, v_b.participant_kind, v_m.participant_b,
              v_m.round_starts_on, v_m.round_ends_on);

    -- A round is closed only once its LAST day has passed. A lead mid-round is
    -- not a result — this is the no-fabrication rule.
    v_closed := v_today > v_m.round_ends_on;
    v_winner := null;
    v_reason := null;

    if v_m.participant_a is not null and v_m.participant_b is null then
      v_winner := v_m.participant_a; v_reason := 'bye';
    elsif v_m.participant_a is null and v_m.participant_b is not null then
      v_winner := v_m.participant_b; v_reason := 'bye';
    elsif v_m.participant_a is not null and v_m.participant_b is not null and v_closed then
      if coalesce(v_pa, 0) > coalesce(v_pb, 0) then
        v_winner := v_m.participant_a; v_reason := 'points';
      elsif coalesce(v_pb, 0) > coalesce(v_pa, 0) then
        v_winner := v_m.participant_b; v_reason := 'points';
      elsif v_m.seed_a is not null and v_m.seed_b is not null then
        if v_m.seed_a < v_m.seed_b then v_winner := v_m.participant_a;
        else v_winner := v_m.participant_b; end if;
        v_reason := 'seed_tiebreak';
      end if;   -- tied with no seeds → stays undecided rather than arbitrary
    end if;

    update public.dc_playoff_matchups
       set points_a = v_pa,
           points_b = v_pb,
           winner_participant_id = v_winner,
           decided_reason = v_reason,
           decided_at = case when v_winner is null then null else coalesce(decided_at, now()) end
     where id = v_m.id
       and (points_a is distinct from v_pa
         or points_b is distinct from v_pb
         or winner_participant_id is distinct from v_winner);
    if found then v_changed := v_changed + 1; end if;

    if v_winner is not null and v_m.next_matchup_id is not null then
      if v_m.next_side = 'a' then
        update public.dc_playoff_matchups
           set participant_a = v_winner,
               seed_a = (select seed from public.dc_playoff_seeds
                          where bracket_id = p_bracket_id and participant_id = v_winner)
         where id = v_m.next_matchup_id and participant_a is distinct from v_winner;
      else
        update public.dc_playoff_matchups
           set participant_b = v_winner,
               seed_b = (select seed from public.dc_playoff_seeds
                          where bracket_id = p_bracket_id and participant_id = v_winner)
         where id = v_m.next_matchup_id and participant_b is distinct from v_winner;
      end if;
    end if;
  end loop;
  end loop;

  select winner_participant_id into v_champ
    from public.dc_playoff_matchups
   where bracket_id = p_bracket_id and round = v_b.rounds and slot = 0;

  update public.dc_playoff_brackets
     set champion_participant_id = v_champ,
         status = case when v_champ is null then 'seeded' else 'final' end
   where id = p_bracket_id
     and (champion_participant_id is distinct from v_champ
       or status is distinct from case when v_champ is null then 'seeded' else 'final' end);

  return v_changed;
end $function$;

-- ── seeding ─────────────────────────────────────────────────────────────────
create or replace function public.fn_playoff_seed_field(
  p_season_id uuid,
  p_actor text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_cfg     public.dc_playoff_config;
  v_seedw   record;
  v_playw   record;
  v_bracket uuid;
  v_field   int;
  v_size    int;
  v_rounds  int;
  v_days    int;
  v_base    int;
  v_extra   int;
  v_cursor  date;
  v_len     int;
  v_r       int;
  v_slot    int;
  v_slots   int;
  v_order   int[];
  v_next    int[];
  v_s       int;
  v_a       int;
  v_b       int;
  v_rs      date;
  v_re      date;
begin
  select * into v_cfg from public.dc_playoff_config where season_id = p_season_id;
  if not found then
    raise exception 'no playoff config for this season' using errcode = 'PLY01';
  end if;

  select * into v_seedw from public.fn_season_phase_window(p_season_id, v_cfg.seeding_source);
  if not found then
    raise exception 'season has no % window to seed from', v_cfg.seeding_source
      using errcode = 'PLY02';
  end if;
  select * into v_playw from public.fn_season_phase_window(p_season_id, 'playoff');
  if not found then
    raise exception 'season has no playoff window — set playoff_starts_on first'
      using errcode = 'PLY03';
  end if;

  -- Replace any prior bracket for this season (cascades seeds + matchups).
  delete from public.dc_playoff_brackets where season_id = p_season_id;

  -- Insert with provisional rounds/qualifier_count; both are corrected below
  -- once the real field size is known. (The field can be smaller than the
  -- configured qualifier_count — you cannot qualify more teams than exist.)
  insert into public.dc_playoff_brackets (
    season_id, format, participant_kind, qualifier_count, rounds,
    seeding_window_from, seeding_window_to, playoff_window_from, playoff_window_to, seeded_by)
  values (
    p_season_id, v_cfg.format, v_cfg.participant_kind, v_cfg.qualifier_count, 1,
    v_seedw.from_on, v_seedw.to_on, v_playw.from_on, v_playw.to_on, p_actor)
  returning id into v_bracket;

  -- ── the qualifying field, from REAL standings over the seeding window ─────
  -- The CTE is referenced twice so the cap is min(configured, actually available)
  -- in one statement — no temp table (which would collide across calls in a
  -- single transaction).
  if v_cfg.participant_kind = 'team' then
    insert into public.dc_playoff_seeds (bracket_id, seed, participant_id, display_name, seed_points)
    with ranked as (
      select row_number() over (order by sum(se.points) desc, min(se.played_at)) as ord,
             t.id as participant_id, t.name as display_name, sum(se.points)::bigint as points
        from public.team_memberships tm
        join public.teams t on t.id = tm.team_id
        join public.dc_subscribers s on s.id = tm.subscriber_id
        join public.score_events se on se.subscriber_id = tm.subscriber_id
         and se.played_at::date between v_seedw.from_on and v_seedw.to_on
       where tm.season_id = p_season_id and tm.pending = false and s.active = true
       group by t.id, t.name)
    select v_bracket, ord, participant_id, display_name, points
      from ranked
     where ord <= least(v_cfg.qualifier_count, (select count(*) from ranked));
  else
    insert into public.dc_playoff_seeds (bracket_id, seed, participant_id, display_name, seed_points)
    with ranked as (
      select row_number() over (order by sum(se.points) desc, min(se.played_at)) as ord,
             s.id as participant_id,
             coalesce(s.handle::text, split_part(s.email::text, '@', 1)) as display_name,
             sum(se.points)::bigint as points
        from public.score_events se
        join public.dc_subscribers s on s.id = se.subscriber_id
       where se.played_at::date between v_seedw.from_on and v_seedw.to_on
         and s.active = true
       group by s.id, s.handle, s.email)
    select v_bracket, ord, participant_id, display_name, points
      from ranked
     where ord <= least(v_cfg.qualifier_count, (select count(*) from ranked));
  end if;

  get diagnostics v_field = row_count;
  if v_field < 2 then
    raise exception 'only % qualifying participant(s) — a bracket needs at least 2', v_field
      using errcode = 'PLY04';
  end if;

  -- Padded size + round count, by doubling (no float log).
  v_size := 2; v_rounds := 1;
  while v_size < v_field loop
    v_size := v_size * 2;
    v_rounds := v_rounds + 1;
  end loop;

  -- Round windows: contiguous, remainder to the EARLIEST rounds.
  v_days := (v_playw.to_on - v_playw.from_on) + 1;
  if v_days < v_rounds then
    raise exception 'playoff window is % day(s) but % round(s) are needed', v_days, v_rounds
      using errcode = 'PLY05';
  end if;
  v_base := v_days / v_rounds;
  v_extra := v_days % v_rounds;

  update public.dc_playoff_brackets
     set qualifier_count = v_field, rounds = v_rounds
   where id = v_bracket;

  -- Reflection seed order: order(2)=[1,2]; each doubling maps s → (s, 2n+1−s).
  v_order := array[1, 2];
  while array_length(v_order, 1) < v_size loop
    v_next := array[]::int[];
    foreach v_s in array v_order loop
      v_next := v_next || v_s || (array_length(v_order, 1) * 2 + 1 - v_s);
    end loop;
    v_order := v_next;
  end loop;

  -- Lay out every round.
  v_cursor := v_playw.from_on;
  for v_r in 1..v_rounds loop
    v_len := v_base + case when v_r <= v_extra then 1 else 0 end;
    v_rs := v_cursor;
    v_re := v_cursor + (v_len - 1);
    v_cursor := v_re + 1;
    v_slots := (v_size / (2 ^ v_r))::int;
    for v_slot in 0..(v_slots - 1) loop
      if v_r = 1 then
        v_a := v_order[v_slot * 2 + 1];
        v_b := v_order[v_slot * 2 + 2];
        insert into public.dc_playoff_matchups (
          bracket_id, round, slot, seed_a, seed_b, participant_a, participant_b,
          round_starts_on, round_ends_on)
        values (
          v_bracket, 1, v_slot,
          case when v_a <= v_field then v_a end,
          case when v_b <= v_field then v_b end,
          (select participant_id from public.dc_playoff_seeds
            where bracket_id = v_bracket and seed = v_a),
          (select participant_id from public.dc_playoff_seeds
            where bracket_id = v_bracket and seed = v_b),
          v_rs, v_re);
      else
        insert into public.dc_playoff_matchups (bracket_id, round, slot, round_starts_on, round_ends_on)
        values (v_bracket, v_r, v_slot, v_rs, v_re);
      end if;
    end loop;
  end loop;

  -- Wire winners forward: round r slot n → round r+1 slot n/2, side a when the
  -- slot is even, b when odd.
  update public.dc_playoff_matchups m
     set next_matchup_id = nxt.id,
         next_side = case when m.slot % 2 = 0 then 'a' else 'b' end
    from public.dc_playoff_matchups nxt
   where m.bracket_id = v_bracket
     and nxt.bracket_id = v_bracket
     and nxt.round = m.round + 1
     and nxt.slot = m.slot / 2;

  -- Settle byes (and anything whose window has already closed).
  perform public.fn_playoff_recompute(v_bracket);
  return v_bracket;
end $function$;

-- ── grants: service_role only (see Part 1/2 for the reasoning) ──────────────
revoke all on function public.fn_playoff_seed_field(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_playoff_recompute(uuid) from public, anon, authenticated;
revoke all on function public.fn_playoff_participant_points(uuid, text, uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_playoff_seed_field(uuid, text) to service_role;
grant execute on function public.fn_playoff_recompute(uuid) to service_role;
grant execute on function public.fn_playoff_participant_points(uuid, text, uuid, date, date) to service_role;

-- ── verification gate ───────────────────────────────────────────────────────
do $gate$
declare v_n int;
begin
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('dc_playoff_config','dc_playoff_brackets','dc_playoff_seeds','dc_playoff_matchups')
     and c.relrowsecurity;
  if v_n <> 4 then raise exception 'gate: expected 4 RLS-enabled playoff tables, found %', v_n; end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('dc_playoff_config','dc_playoff_brackets','dc_playoff_seeds','dc_playoff_matchups');
  if v_n <> 0 then raise exception 'gate: playoff tables must have ZERO policies, found %', v_n; end if;

  if exists (select 1 from information_schema.routine_privileges
     where specific_schema = 'public'
       and routine_name in ('fn_playoff_seed_field','fn_playoff_recompute','fn_playoff_participant_points')
       and grantee in ('anon','authenticated','PUBLIC')) then
    raise exception 'gate: playoff functions must not be anon/authenticated executable';
  end if;

  if not exists (select 1 from pg_indexes where schemaname = 'public'
                  and indexname = 'dc_playoff_brackets_one_per_season') then
    raise exception 'gate: missing the one-bracket-per-season unique index';
  end if;
end $gate$;

commit;
