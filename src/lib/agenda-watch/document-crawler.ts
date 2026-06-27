// AgendaWatch document crawler.
// Fetches agenda / minutes documents from Legistar and CivicPlus endpoints
// for monitored jurisdictions and writes rows to agenda_watch_documents.
//
// Env required: PIPELINE_SECRET, SUPABASE_SERVICE_ROLE_KEY
// Optional:     LEGISTAR_API_KEY, CIVICPLUS_API_KEY

import { Svc } from '@/lib/pipeline-utils';

export interface CrawlResult {
  fetched:  number;
  inserted: number;
  skipped:  number;
  errors:   number;
}

export async function crawlAgendaWatchEntities(
  limit: number,
  svc: Svc
): Promise<CrawlResult> {
  const result: CrawlResult = { fetched: 0, inserted: 0, skipped: 0, errors: 0 };

  // Fetch monitored jurisdictions that have Legistar or CivicPlus endpoints configured.
  const r = await fetch(
    `${svc.base}/agenda_watch_sources?is_active=eq.true&limit=${limit}&select=id,jurisdiction_id,source_type,endpoint_url,last_crawled_at`,
    { headers: svc.headers, cache: 'no-store' }
  );
  if (!r.ok) {
    console.error('[agenda-watch/crawl] fetch sources failed', r.status);
    return result;
  }

  const sources: AgendaWatchSource[] = await r.json().catch(() => []);
  result.fetched = sources.length;

  for (const src of sources) {
    try {
      const docs = await fetchDocumentsForSource(src);
      for (const doc of docs) {
        const ins = await fetch(`${svc.base}/agenda_watch_documents`, {
          method:  'POST',
          headers: { ...svc.headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body:    JSON.stringify({
            source_id:       src.id,
            jurisdiction_id: src.jurisdiction_id,
            document_url:    doc.url,
            title:           doc.title,
            document_date:   doc.date,
            document_type:   doc.type,
            crawled_at:      new Date().toISOString(),
          }),
        });
        if (ins.ok) result.inserted++;
        else        result.skipped++;
      }
      // Update last_crawled_at
      await fetch(`${svc.base}/agenda_watch_sources?id=eq.${src.id}`, {
        method:  'PATCH',
        headers: svc.headers,
        body:    JSON.stringify({ last_crawled_at: new Date().toISOString() }),
      });
    } catch (err) {
      console.error('[agenda-watch/crawl] source error', src.id, err);
      result.errors++;
    }
  }

  return result;
}

interface AgendaWatchSource {
  id:             string;
  jurisdiction_id: string;
  source_type:    'legistar' | 'civicplus' | 'generic';
  endpoint_url:   string;
  last_crawled_at: string | null;
}

interface DocumentMeta {
  url:   string;
  title: string;
  date:  string | null;
  type:  string;
}

async function fetchDocumentsForSource(src: AgendaWatchSource): Promise<DocumentMeta[]> {
  if (src.source_type === 'legistar') return fetchLegistarDocuments(src);
  if (src.source_type === 'civicplus') return fetchCivicPlusDocuments(src);
  return [];
}

async function fetchLegistarDocuments(src: AgendaWatchSource): Promise<DocumentMeta[]> {
  // Legistar REST API v1 — /Meetings endpoint filtered by date range
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const url   = `${src.endpoint_url}/Meetings?$filter=MeetingDate ge datetime'${since}T00:00:00'&$select=MeetingId,MeetingDate,MeetingAgendaFile`;
  try {
    const r    = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return [];
    const rows: any[] = await r.json().catch(() => []);
    return rows
      .filter(m => m.MeetingAgendaFile)
      .map(m => ({
        url:   m.MeetingAgendaFile,
        title: `Meeting Agenda ${m.MeetingDate?.slice(0, 10) ?? ''}`,
        date:  m.MeetingDate?.slice(0, 10) ?? null,
        type:  'agenda',
      }));
  } catch {
    return [];
  }
}

async function fetchCivicPlusDocuments(src: AgendaWatchSource): Promise<DocumentMeta[]> {
  // CivicPlus SiteScribe / CivicWeb public JSON endpoint
  try {
    const r    = await fetch(`${src.endpoint_url}?days=7`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    const items: any[] = data?.items ?? data?.documents ?? [];
    return items.map(i => ({
      url:   i.url ?? i.fileUrl ?? '',
      title: i.title ?? i.name ?? 'Document',
      date:  i.date ?? i.meetingDate ?? null,
      type:  i.type ?? 'agenda',
    })).filter(d => d.url);
  } catch {
    return [];
  }
}
