-- faraday_ops_snapshot: single-call metrics rollup for the daily ops email
-- (edge function faraday-daily-ops). Health freshness + 24h activity counts.
create or replace function public.faraday_ops_snapshot()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'now', now(),
    'artifact_last',     (select max(discovered_at) from artifacts),
    'artifact_hours',    round(extract(epoch from (now() - (select max(discovered_at) from artifacts)))/3600, 1),
    'artifacts_24h',     (select count(*) from artifacts where discovered_at > now() - interval '24 hours'),
    'artifacts_total',   (select count(*) from artifacts),
    'enrich_last',       (select max(created_at) from artifact_enrichments),
    'enrich_24h',        (select count(*) from artifact_enrichments where created_at > now() - interval '24 hours'),
    'health_last',       (select max(run_completed_at) from automation_health_log),
    'health_hours',      round(extract(epoch from (now() - (select max(run_completed_at) from automation_health_log)))/3600, 1),
    'health_runs_24h',   (select count(*) from automation_health_log where run_started_at > now() - interval '24 hours'),
    'health_fail_24h',   (select count(*) from automation_health_log where run_started_at > now() - interval '24 hours' and success is not true),
    'signals_24h',       (select count(*) from signals where fired_at > now() - interval '24 hours'),
    'jsignals_24h',      (select count(*) from jurisdiction_signals where triggered_at > now() - interval '24 hours')
  );
$$;

revoke all on function public.faraday_ops_snapshot() from public, anon;
grant execute on function public.faraday_ops_snapshot() to service_role;
