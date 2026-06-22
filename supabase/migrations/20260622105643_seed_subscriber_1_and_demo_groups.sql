-- Leaderboard V2 §10: idempotent seed so no board is ever empty. Synthetic rows
-- use @example.com + demo_ handles (trivially removable); the real mykemiller@
-- gmail.com is preserved. teams.season is NOT NULL -> set via current_season().
INSERT INTO public.dc_subscribers (email, handle, play_streak, full_set_streak, mw_balance, timezone, source)
VALUES ('mykemiller@gmail.com','myke',6,3,540,'America/Chicago','seed')
ON CONFLICT (email) DO UPDATE SET handle = EXCLUDED.handle;

INSERT INTO public.teams (code,name,group_type,created_by_email,season)
VALUES ('DELOITTE','Deloitte','company','mykemiller@gmail.com', public.current_season())
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.teams (code,name,group_type,parent_id,created_by_email,season)
SELECT 'HCI','Hybrid Cloud Infrastructure','team', c.id, 'mykemiller@gmail.com', public.current_season()
FROM public.teams c WHERE c.code='DELOITTE' ON CONFLICT (code) DO NOTHING;

INSERT INTO public.team_members (team_id, member_email, role)
SELECT t.id,'mykemiller@gmail.com','creator' FROM public.teams t WHERE t.code IN ('DELOITTE','HCI')
ON CONFLICT (team_id, member_email) DO NOTHING;

INSERT INTO public.dc_subscribers (email, handle, play_streak, full_set_streak, mw_balance, timezone, source) VALUES
  ('alex@example.com','demo_alex',4,2,610,'America/Chicago','seed'),
  ('priya@example.com','demo_priya',9,5,880,'America/Chicago','seed'),
  ('sam@example.com','demo_sam',2,0,300,'America/Chicago','seed'),
  ('jordan@example.com','demo_jordan',7,4,720,'America/Chicago','seed'),
  ('lee@example.com','demo_lee',1,0,150,'America/Chicago','seed')
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.teams (code,name,group_type,parent_id,created_by_email,season)
SELECT 'DELOITTE-NET','Network Edge','team', c.id,'alex@example.com', public.current_season()
FROM public.teams c WHERE c.code='DELOITTE' ON CONFLICT (code) DO NOTHING;

INSERT INTO public.team_members (team_id, member_email, role)
SELECT t.id, m.email, 'member' FROM public.teams t
JOIN (VALUES
  ('alex@example.com','HCI'),('priya@example.com','HCI'),('sam@example.com','HCI'),
  ('jordan@example.com','DELOITTE-NET'),('lee@example.com','DELOITTE-NET'),
  ('alex@example.com','DELOITTE'),('priya@example.com','DELOITTE'),
  ('sam@example.com','DELOITTE'),('jordan@example.com','DELOITTE'),('lee@example.com','DELOITTE')
) AS m(email,code) ON t.code = m.code
ON CONFLICT (team_id, member_email) DO NOTHING;

INSERT INTO public.dc_completions (subscriber_id, puzzle_type, puzzle_date, score, mw_earned)
SELECT s.id, p.ptype, (now() AT TIME ZONE 'America/Chicago')::date, p.score, p.mw
FROM public.dc_subscribers s
JOIN (VALUES
  ('mykemiller@gmail.com','Circuit',95,140),('mykemiller@gmail.com','Rackl',88,120),
  ('priya@example.com','Circuit',99,150),('priya@example.com','Rackl',92,130),
  ('alex@example.com','Circuit',80,110),('jordan@example.com','Rackl',85,115),
  ('sam@example.com','Circuit',60,80),('lee@example.com','Rackl',40,55)
) AS p(email,ptype,score,mw) ON s.email = p.email
ON CONFLICT (subscriber_id, puzzle_type, puzzle_date) DO NOTHING;

-- teardown (does NOT touch the real mykemiller@gmail.com):
--   DELETE FROM public.dc_completions WHERE subscriber_id IN (SELECT id FROM public.dc_subscribers WHERE source='seed' AND handle LIKE 'demo_%');
--   DELETE FROM public.team_members WHERE member_email LIKE '%@example.com';
--   DELETE FROM public.teams WHERE code IN ('DELOITTE','HCI','DELOITTE-NET');
--   DELETE FROM public.dc_subscribers WHERE source='seed' AND handle LIKE 'demo_%';
