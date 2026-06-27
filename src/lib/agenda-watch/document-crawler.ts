// Fetches new agenda and minutes documents from all active entities.
// Dispatches to a per-platform crawler, then marks the entity with a
// last_crawled_at timestamp. Error counter increments on failure; at 5
// consecutive errors the entity is moved to status 'error'.

import type { AgendaWatchDb, Row } from './db-client';

const UA = 'FaradayIntelligence/1.0 (research@faraday-intelligence.ai)';

export async function crawlAgendaWatchEntities(
  db: AgendaWatchDb,
  batchSize = 50,
): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const { data: entities, error } = await db
    .from('agenda_watch_entities')
    .select('*')
    .eq('crawl_status', 'active')
    .or(`last_crawled_at.is.null,last_crawled_at.lt.${cutoff}`)
    .order('last_crawled_at', { ascending: true, nullsFirst: true })
    .limit(batchSize)
    .run();

  if (error || !entities) {
    console.error('crawlAgendaWatchEntities: fetch failed:', error);
    return;
  }

  for (const raw of entities) {
    const entity = raw as Row & { id: string; entity_name: string; error_count: number; cms_platform: string };

    try {
      await crawlEntity(db, entity);
      await db
        .from('agenda_watch_entities')
        .update({ last_crawled_at: new Date().toISOString(), error_count: 0 })
        .eq('id', entity.id)
        .run();
    } catch (e) {
      console.error(`Entity ${entity.entity_name} crawl failed:`, e);
      const nextCount  = (entity.error_count ?? 0) + 1;
      const nextStatus = nextCount >= 5 ? 'error' : 'active';
      await db
        .from('agenda_watch_entities')
        .update({ error_count: nextCount, crawl_status: nextStatus })
        .eq('id', entity.id)
        .run();
    }
  }
}

async function crawlEntity(db: AgendaWatchDb, entity: Row): Promise<void> {
  switch (entity.cms_platform as string) {
    case 'Legistar':   return crawlLegistar(db, entity);
    case 'CivicPlus':  return crawlCivicPlus(db, entity);
    case 'BoardDocs':  return crawlBoardDocs(db, entity);
    case 'Municode':   return crawlMunicode(db, entity);
    default:           return crawlGeneric(db, entity);
  }
}

// ── Legistar ──────────────────────────────────────────────────────────────────

async function crawlLegistar(db: AgendaWatchDb, entity: Row): Promise<void> {
  const client = entity.api_client_id as string;
  const since  = new Date(Date.now() - 90 * 86_400_000).toISOString().split('T')[0];
  const url    =
    `https://webapi.legistar.com/v1/${client}/Events` +
    `?$filter=EventDate ge datetime'${since}'&$orderby=EventDate desc`;

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Legistar API error: ${res.status}`);

  const events: Record<string, unknown>[] = await res.json();

  for (const event of events) {
    const itemsUrl = `https://webapi.legistar.com/v1/${client}/EventItems/${event.EventId}`;
    const itemsRes = await fetch(itemsUrl, { headers: { 'User-Agent': UA } });
    if (!itemsRes.ok) continue;

    const items: Record<string, unknown>[] = await itemsRes.json();

    for (const item of items) {
      const attachments = item.EventItemMatterAttachments as Record<string, unknown>[] | undefined;
      if (!attachments) continue;

      for (const att of attachments) {
        const href = att.MatterAttachmentHyperlink as string | undefined;
        if (!href) continue;

        const name    = (att.MatterAttachmentName as string | undefined) ?? '';
        const docType = name.toLowerCase().includes('minute') ? 'minutes' : 'agenda';
        const dateStr = (event.EventDate as string | undefined)?.split('T')[0];

        await upsertDoc(db, {
          entity_id:        entity.id,
          jurisdiction_id:  entity.jurisdiction_id,
          doc_type:         docType,
          meeting_date:     dateStr ?? null,
          meeting_body:     event.EventBodyName,
          source_url:       href,
          extraction_method: 'legistar_api',
        });
      }
    }

    await new Promise(r => setTimeout(r, 100));
  }
}

// ── CivicPlus ─────────────────────────────────────────────────────────────────

async function crawlCivicPlus(db: AgendaWatchDb, entity: Row): Promise<void> {
  const listUrl = `${entity.base_url}/Home/ShowPublishedAgendasJson`;
  const res = await fetch(listUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CivicPlus JSON error: ${res.status}`);

  const data    = await res.json();
  const meetings: Record<string, unknown>[] = data?.ListAgendasModels ?? data ?? [];

  for (const meeting of meetings.slice(0, 20)) {
    const agendaPath  = meeting.AgendaViewUrl  as string | undefined;
    const minutesPath = meeting.MinutesViewUrl as string | undefined;

    if (agendaPath) {
      await upsertDoc(db, {
        entity_id:        entity.id,
        jurisdiction_id:  entity.jurisdiction_id,
        doc_type:         'agenda',
        meeting_date:     (meeting.MeetingDate as string | undefined)?.split('T')[0] ?? null,
        meeting_body:     meeting.Name,
        source_url:       `${entity.base_url}${agendaPath}`,
        extraction_method: 'civicplus_json',
      });
    }
    if (minutesPath && minutesPath !== agendaPath) {
      await upsertDoc(db, {
        entity_id:        entity.id,
        jurisdiction_id:  entity.jurisdiction_id,
        doc_type:         'minutes',
        meeting_date:     (meeting.MeetingDate as string | undefined)?.split('T')[0] ?? null,
        meeting_body:     meeting.Name,
        source_url:       `${entity.base_url}${minutesPath}`,
        extraction_method: 'civicplus_json',
      });
    }
  }
}

// ── BoardDocs ─────────────────────────────────────────────────────────────────

async function crawlBoardDocs(db: AgendaWatchDb, entity: Row): Promise<void> {
  const jsonUrl = `${entity.base_url}/RJSON?open`;
  const res = await fetch(jsonUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`BoardDocs error: ${res.status}`);

  const data = await res.json();
  const meetings: Record<string, unknown>[] = data?.BoardDocsMeetings ?? [];

  for (const meeting of meetings.slice(0, 20)) {
    const docUrl = `${entity.base_url}/Public#agenda/${meeting.UniqueKey}/agenda`;
    await upsertDoc(db, {
      entity_id:        entity.id,
      jurisdiction_id:  entity.jurisdiction_id,
      doc_type:         'agenda',
      meeting_date:     meeting.MeetingDate as string | null,
      meeting_body:     meeting.Name,
      source_url:       docUrl,
      extraction_method: 'boarddocs_api',
    });
  }
}

// ── Municode ──────────────────────────────────────────────────────────────────

async function crawlMunicode(db: AgendaWatchDb, entity: Row): Promise<void> {
  const res = await fetch(entity.agenda_url as string, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return;

  const html = await res.text();
  const pdfLinks = [...html.matchAll(/href="([^"]*\.pdf[^"]*)"/gi)].map(m => m[1]);

  for (const href of pdfLinks.slice(0, 10)) {
    const absUrl = href.startsWith('http') ? href : `https://municode.com${href}`;
    await upsertDoc(db, {
      entity_id:        entity.id,
      jurisdiction_id:  entity.jurisdiction_id,
      doc_type:         'minutes',
      source_url:       absUrl,
      extraction_method: 'html_scrape',
    });
  }
}

// ── Generic / Custom ─────────────────────────────────────────────────────────

async function crawlGeneric(db: AgendaWatchDb, entity: Row): Promise<void> {
  const target = (entity.minutes_url ?? entity.base_url) as string;
  const res = await fetch(target, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return;

  const html = await res.text();
  const pdfLinks = [...html.matchAll(/href="([^"]*\.pdf[^"]*)"/gi)]
    .map(m => m[1])
    .filter(href => /minute|agenda/i.test(href));

  for (const href of pdfLinks.slice(0, 10)) {
    const absUrl  = href.startsWith('http') ? href : `${entity.base_url}${href}`;
    const docType: 'minutes' | 'agenda' = /minute/i.test(href) ? 'minutes' : 'agenda';

    await upsertDoc(db, {
      entity_id:        entity.id,
      jurisdiction_id:  entity.jurisdiction_id,
      doc_type:         docType,
      source_url:       absUrl,
      extraction_method: 'html_scrape',
    });
  }
}

// ── Shared upsert ─────────────────────────────────────────────────────────────

async function upsertDoc(db: AgendaWatchDb, doc: Record<string, unknown>): Promise<void> {
  const { error } = await db
    .from('agenda_watch_documents')
    .upsert(doc, { onConflict: 'entity_id,source_url' })
    .run();
  if (error) console.error('upsertDoc error:', error);
}
