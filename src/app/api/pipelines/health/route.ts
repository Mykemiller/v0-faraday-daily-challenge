// POST /api/pipelines/health
// Vercel cron: Sunday 06:00 UTC  (schedule: "0 6 * * 0")
// Checks that each pipeline has produced data recently.
// Writes unresolved alerts to pipeline_health_alerts.
// Returns { status: 'healthy' | 'warning' | 'critical', alerts_fired, alerts }.

export const maxDuration = 60;

import { isAuthorized, getServiceClient } from '@/lib/pipeline-utils';

interface PipelineCheck {
  name:            string;
  table:           string;
  timestampColumn: string;
  maxAgeHours:     number;
  severity:        'critical' | 'warning';
}

const PIPELINE_CHECKS: PipelineCheck[] = [
  {
    name: 'agenda-watch-crawl',
    table: 'agenda_watch_documents',
    timestampColumn: 'crawled_at',
    maxAgeHours: 192,
    severity: 'warning',
  },
  {
    name: 'puc-crawl',
    table: 'puc_filings',
    timestampColumn: 'crawled_at',
    maxAgeHours: 192,
    severity: 'warning',
  },
  {
    name: 'data365-fetch',
    table: 'data365_posts',
    timestampColumn: 'fetched_at',
    maxAgeHours: 192,
    severity: 'warning',
  },
  {
    name: 'eia-refresh',
    table: 'eia_state_electricity',
    timestampColumn: 'fetched_at',
    maxAgeHours: 720,
    severity: 'warning',
  },
  {
    name: 'jps-dimension-update',
    table: 'jurisdictions',
    timestampColumn: 'last_scored_at',
    maxAgeHours: 192,
    severity: 'critical',
  },
  {
    name: 'idf-ingestion',
    table: 'idf_signals',
    timestampColumn: 'ingested_at',
    maxAgeHours: 192,
    severity: 'warning',
  },
];

interface Alert {
  alert_type:    string;
  pipeline_name: string;
  message:       string;
  severity:      'critical' | 'warning';
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = getServiceClient();
  if (!svc) {
    return Response.json({ error: 'Service client not configured' }, { status: 500 });
  }

  const alerts: Alert[] = [];

  for (const check of PIPELINE_CHECKS) {
    try {
      const r = await fetch(
        `${svc.base}/${check.table}?select=${check.timestampColumn}&order=${check.timestampColumn}.desc&limit=1`,
        { headers: svc.headers, cache: 'no-store' }
      );
      if (!r.ok) continue;

      const rows: Record<string, string>[] = await r.json().catch(() => []);
      const lastRunStr = rows[0]?.[check.timestampColumn] ?? null;
      const lastRun    = lastRunStr ? new Date(lastRunStr) : null;
      const ageHours   = lastRun
        ? (Date.now() - lastRun.getTime()) / 3_600_000
        : 999;

      if (ageHours > check.maxAgeHours) {
        alerts.push({
          alert_type:    'pipeline_stale',
          pipeline_name: check.name,
          message:       `${check.name} last ran ${ageHours.toFixed(0)}h ago (threshold: ${check.maxAgeHours}h)`,
          severity:      check.severity,
        });
      }
    } catch (err) {
      console.error(`[pipeline/health] check failed for ${check.name}`, err);
    }
  }

  // IDF backlog check
  try {
    const backlogR = await fetch(
      `${svc.base}/agenda_watch_signals?idf_ingested=eq.false&select=id&limit=1`,
      { headers: { ...svc.headers, Prefer: 'count=exact' }, cache: 'no-store' }
    );
    const contentRange = backlogR.headers.get('Content-Range') ?? '';
    const total = parseInt(contentRange.split('/')[1] ?? '0', 10);
    if (total > 5000) {
      alerts.push({
        alert_type:    'idf_backlog',
        pipeline_name: 'idf-ingestion',
        message:       `IDF ingestion backlog: ${total} pending agenda signals`,
        severity:      'warning',
      });
    }
  } catch { /* non-fatal */ }

  // Stale JDS check
  try {
    const staleTs  = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const staleR   = await fetch(
      `${svc.base}/jurisdictions?is_active=eq.true&jds_updated_at=lt.${staleTs}&select=id&limit=1`,
      { headers: { ...svc.headers, Prefer: 'count=exact' }, cache: 'no-store' }
    );
    const cr    = staleR.headers.get('Content-Range') ?? '';
    const count = parseInt(cr.split('/')[1] ?? '0', 10);
    if (count > 100) {
      alerts.push({
        alert_type:    'stale_jds',
        pipeline_name: 'jds-normalize',
        message:       `${count} jurisdictions have stale JDS data (>10 days)`,
        severity:      'critical',
      });
    }
  } catch { /* non-fatal */ }

  if (alerts.length > 0) {
    await fetch(`${svc.base}/pipeline_health_alerts`, {
      method:  'POST',
      headers: svc.headers,
      body:    JSON.stringify(alerts),
    });
    console.error('[pipeline/health] ALERTS:', JSON.stringify(alerts));
  }

  const status = alerts.some(a => a.severity === 'critical') ? 'critical'
               : alerts.length > 0 ? 'warning'
               : 'healthy';

  return Response.json({
    checked_at:   new Date().toISOString(),
    alerts_fired: alerts.length,
    alerts,
    status,
  });
}
