-- Leaderboard V2 §7.4: hierarchy-aware, period-scoped team standings.
-- Rank members + groups by period Signals from dc_completions (never lifetime mw_total).

-- Distinct member set of a group. For a company: child-team members UNION direct
-- company members (no double-count). For a team/custom: direct members only.
CREATE OR REPLACE FUNCTION public.fn_group_member_emails(p_group uuid)
RETURNS TABLE(member_email citext)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT DISTINCT m.member_email FROM (
    SELECT tm.member_email FROM public.team_members tm WHERE tm.team_id = p_group
    UNION
    SELECT tm.member_email FROM public.team_members tm
    JOIN public.teams ch ON ch.id = tm.team_id
    WHERE ch.parent_id = p_group
      AND (SELECT group_type FROM public.teams WHERE id = p_group) = 'company'
  ) m;
$$;

-- A group's members ranked by period Signals (daily or season drop-2). Members
-- with 0 signals this period still appear (real roster, not fabricated zeros).
CREATE OR REPLACE FUNCTION public.fn_group_member_board(
  p_group uuid, p_period text, p_day date, p_season uuid, p_limit int DEFAULT 50)
RETURNS TABLE(rank bigint, subscriber_id uuid, signals bigint, play_streak int, full_set_streak int)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH member_subs AS (
    SELECT s.id, s.play_streak, s.full_set_streak
    FROM public.fn_group_member_emails(p_group) g
    JOIN public.dc_subscribers s ON s.email = g.member_email
  ),
  win AS (SELECT starts_on, ends_on FROM public.seasons WHERE id = p_season),
  season_per_day AS (
    SELECT c.subscriber_id, c.puzzle_date, SUM(c.mw_earned)::bigint AS day_signals
    FROM public.dc_completions c, win
    WHERE p_period = 'season' AND c.puzzle_date BETWEEN win.starts_on AND win.ends_on
    GROUP BY c.subscriber_id, c.puzzle_date
  ),
  season_ranked AS (
    SELECT subscriber_id, day_signals,
      ROW_NUMBER() OVER (PARTITION BY subscriber_id ORDER BY day_signals ASC) AS lo_rank,
      COUNT(*) OVER (PARTITION BY subscriber_id) AS n_days
    FROM season_per_day
  ),
  season_tot AS (
    SELECT subscriber_id, (SUM(day_signals) FILTER (WHERE n_days <= 2 OR lo_rank > 2))::bigint AS signals
    FROM season_ranked GROUP BY subscriber_id
  ),
  daily_tot AS (
    SELECT c.subscriber_id, SUM(c.mw_earned)::bigint AS signals
    FROM public.dc_completions c
    WHERE p_period <> 'season' AND c.puzzle_date = p_day
    GROUP BY c.subscriber_id
  ),
  joined AS (
    SELECT ms.id AS subscriber_id, ms.play_streak, ms.full_set_streak,
      CASE WHEN p_period = 'season' THEN coalesce(st.signals, 0) ELSE coalesce(dt.signals, 0) END AS signals
    FROM member_subs ms
    LEFT JOIN season_tot st ON st.subscriber_id = ms.id
    LEFT JOIN daily_tot dt ON dt.subscriber_id = ms.id
  )
  SELECT RANK() OVER (ORDER BY signals DESC, full_set_streak DESC, play_streak DESC),
         subscriber_id, signals, play_streak, full_set_streak
  FROM joined
  ORDER BY signals DESC, full_set_streak DESC, play_streak DESC
  LIMIT p_limit;
$$;

-- Aggregate period Signals for a whole group (sum over its distinct members).
CREATE OR REPLACE FUNCTION public.fn_group_period_signals(
  p_group uuid, p_period text, p_day date, p_season uuid)
RETURNS bigint
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(SUM(b.signals), 0)::bigint
  FROM public.fn_group_member_board(p_group, p_period, p_day, p_season, 2147483647) b;
$$;

-- Sibling teams under a company, ranked (team-vs-team).
CREATE OR REPLACE FUNCTION public.fn_company_team_standings(
  p_company uuid, p_period text, p_day date, p_season uuid)
RETURNS TABLE(team_id uuid, code citext, name text, signals bigint, rank bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH sib AS (
    SELECT t.id, t.code, t.name,
           public.fn_group_period_signals(t.id, p_period, p_day, p_season) AS signals
    FROM public.teams t WHERE t.parent_id = p_company AND t.group_type = 'team'
  )
  SELECT id, code, name, signals, RANK() OVER (ORDER BY signals DESC, name ASC)
  FROM sib ORDER BY signals DESC, name ASC;
$$;

-- All companies, ranked (company-vs-company).
CREATE OR REPLACE FUNCTION public.fn_company_standings(
  p_period text, p_day date, p_season uuid)
RETURNS TABLE(company_id uuid, code citext, name text, signals bigint, rank bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH co AS (
    SELECT t.id, t.code, t.name,
           public.fn_group_period_signals(t.id, p_period, p_day, p_season) AS signals
    FROM public.teams t WHERE t.group_type = 'company'
  )
  SELECT id, code, name, signals, RANK() OVER (ORDER BY signals DESC, name ASC)
  FROM co ORDER BY signals DESC, name ASC;
$$;

-- rollback:
--   DROP FUNCTION IF EXISTS public.fn_company_standings(text, date, uuid);
--   DROP FUNCTION IF EXISTS public.fn_company_team_standings(uuid, text, date, uuid);
--   DROP FUNCTION IF EXISTS public.fn_group_period_signals(uuid, text, date, uuid);
--   DROP FUNCTION IF EXISTS public.fn_group_member_board(uuid, text, date, uuid, int);
--   DROP FUNCTION IF EXISTS public.fn_group_member_emails(uuid);
