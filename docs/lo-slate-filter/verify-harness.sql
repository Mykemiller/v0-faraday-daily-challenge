
-- ══ CC-LO-SLATE-FILTER-1.0 harness — everything inside one aborted txn ══
do $harness$
declare
  v_cfg   uuid := '9afb9857-6dc4-4b14-ad0b-93fad98ff4b3';  -- Season 3, draft, 7/7/3
  v_all   jsonb;
  v_live  jsonb;
  v_bad   jsonb;
  v_res   jsonb;
  n int; m int; k int;
  v_msg text; v_state text;
  pass int := 0; fail int := 0;
  rpt text := '';
begin
  -- payload A: all 18 catalog rows, live ones enabled, new_idea ones UNCHECKED
  select jsonb_agg(jsonb_build_object(
           'game_id', id, 'is_enabled', lifecycle_state = 'live',
           'weight', 1, 'sort_order', sort_order))
    into v_all from game_catalog;

  -- payload B: only the 7 assignable rows
  select jsonb_agg(jsonb_build_object(
           'game_id', id, 'is_enabled', true, 'weight', 1, 'sort_order', sort_order))
    into v_live from game_catalog where lifecycle_state in ('live','in_test');

  -- payload C: one new_idea game ENABLED (the forced trigger error)
  select v_live || jsonb_build_array(jsonb_build_object(
           'game_id', id, 'is_enabled', true, 'weight', 1, 'sort_order', 99))
    into v_bad from game_catalog where game_key = 'grid_lock';

  -- ── T1: 18 in → 7 written, 11 named as dropped ────────────────────────────
  v_res := season_config_save_bundle(v_cfg, null, v_all, null, null, null);
  select count(*) into n from season_games where season_config_id = v_cfg;
  if (v_res->>'games')::int = 7 and n = 7
     and jsonb_array_length(v_res->'dropped_games') = 11 then
    pass := pass+1; rpt := rpt || 'PASS T1  18 sent → 7 written, 11 dropped | ';
  else
    fail := fail+1; rpt := rpt || format('FAIL T1  res=%s rows=%s | ', v_res, n);
  end if;

  -- ── T2: only assignable games are present ─────────────────────────────────
  select count(*) into n from season_games sg join game_catalog g on g.id=sg.game_id
   where sg.season_config_id = v_cfg and g.lifecycle_state not in ('live','in_test');
  if n = 0 then pass:=pass+1; rpt := rpt || 'PASS T2  no non-assignable row written | ';
  else fail:=fail+1; rpt := rpt || format('FAIL T2  %s non-assignable rows | ', n); end if;

  -- ── T3: mixes untouched when p_theme/p_difficulty are null ────────────────
  select count(*) into n from season_theme_mix where season_config_id=v_cfg;
  select count(*) into m from season_difficulty_mix where season_config_id=v_cfg;
  if n=7 and m=3 then pass:=pass+1; rpt := rpt || 'PASS T3  null child args leave mixes alone (7/3) | ';
  else fail:=fail+1; rpt := rpt || format('FAIL T3  theme=%s diff=%s | ', n, m); end if;

  -- ── T4: config scalars round-trip, non-writable keys ignored ──────────────
  v_res := season_config_save_bundle(
    v_cfg,
    jsonb_build_object('games_per_day', 5, 'label', 'harness label',
                       'state', 'active', 'version', 99, 'season_id', gen_random_uuid()),
    null, null, null, null);
  select count(*) into n from season_config
   where id=v_cfg and games_per_day=5 and label='harness label'
     and state='draft' and version=1;
  if n=1 then pass:=pass+1; rpt := rpt || 'PASS T4  scalars written, state/version/season_id refused | ';
  else fail:=fail+1; rpt := rpt || 'FAIL T4  whitelist leak or scalar not written | '; end if;

  -- ── T5: enabling a new_idea game raises the TRIGGER'S OWN message ─────────
  begin
    v_res := season_config_save_bundle(v_cfg, null, v_bad, null, null, null);
    fail:=fail+1; rpt := rpt || 'FAIL T5  enabled new_idea game was accepted | ';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_state='23514' and v_msg like '%lifecycle state is new_idea%' then
      pass:=pass+1; rpt := rpt || format('PASS T5  %s / %s | ', v_state, v_msg);
    else
      fail:=fail+1; rpt := rpt || format('FAIL T5  %s / %s | ', v_state, v_msg);
    end if;
  end;

  -- ── T6: THE PARTIAL-COMMIT TEST — a failed bundle rolls the mixes back ────
  -- Pre-state: slate 7, theme 7, difficulty 3. Send a bundle that rewrites the
  -- mixes AND trips the trigger. Nothing may change.
  begin
    perform season_config_save_bundle(
      v_cfg, jsonb_build_object('games_per_day', 1), v_bad,
      '[{"theater_id":"HARNESS","target_pct":100}]'::jsonb,
      '[{"difficulty_band":"harness","target_pct":100}]'::jsonb, null);
    fail:=fail+1; rpt := rpt || 'FAIL T6  bundle did not raise | ';
  exception when others then
    select count(*) into n from season_theme_mix where season_config_id=v_cfg;
    select count(*) into m from season_difficulty_mix where season_config_id=v_cfg;
    select count(*) into k from season_games where season_config_id=v_cfg;
    if n=7 and m=3 and k=7 then
      pass:=pass+1; rpt := rpt || 'PASS T6  failed bundle left NO partial write (7/7/3 intact) | ';
    else
      fail:=fail+1; rpt := rpt || format('FAIL T6  PARTIAL COMMIT theme=%s diff=%s games=%s | ', n, m, k);
    end if;
  end;

  -- ── T7: puzzle_count survives a slate replace ─────────────────────────────
  update season_games set puzzle_count = 42
   where season_config_id=v_cfg
     and game_id = (select id from game_catalog where game_key='rackl');
  perform season_config_save_bundle(v_cfg, null, v_all, null, null, null);
  select puzzle_count into n from season_games
   where season_config_id=v_cfg and game_id=(select id from game_catalog where game_key='rackl');
  if n=42 then pass:=pass+1; rpt := rpt || 'PASS T7  puzzle_count carried across the replace | ';
  else fail:=fail+1; rpt := rpt || format('FAIL T7  puzzle_count = %s | ', coalesce(n::text,'null')); end if;

  -- ── T8: promoting a game to in_test makes it assignable, no code change ───
  update game_catalog set lifecycle_state='in_test' where game_key='grid_lock';
  select jsonb_agg(jsonb_build_object(
           'game_id', id, 'is_enabled', true, 'weight', 1, 'sort_order', sort_order))
    into v_live from game_catalog where lifecycle_state in ('live','in_test');
  v_res := season_config_save_bundle(v_cfg, null, v_live, null, null, null);
  if (v_res->>'games')::int = 8 then
    pass:=pass+1; rpt := rpt || 'PASS T8  in_test game assignable → slate of 8 | ';
  else fail:=fail+1; rpt := rpt || format('FAIL T8  games=%s | ', v_res->>'games'); end if;

  -- ── T9: a locked season is refused with 55P03 ─────────────────────────────
  update seasons set locked_at = now()
   where id = (select season_id from season_config where id=v_cfg);
  begin
    perform season_config_save_bundle(v_cfg, null, v_live, null, null, null);
    fail:=fail+1; rpt := rpt || 'FAIL T9  locked season accepted a write | ';
  exception when others then
    get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
    if v_state='55P03' then pass:=pass+1; rpt := rpt || format('PASS T9  55P03 / %s | ', v_msg);
    else fail:=fail+1; rpt := rpt || format('FAIL T9  %s / %s | ', v_state, v_msg); end if;
  end;

  raise exception '[% PASSED / % FAILED] %', pass, fail, rpt;
end $harness$;

