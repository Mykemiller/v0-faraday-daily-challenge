// Seed agenda_watch_entities from Legistar's public REST API.
// Legistar (Granicus) has 7,000+ government clients discoverable via the
// webapi.legistar.com public endpoint. No auth required.

import type { AgendaWatchDb } from './db-client';

interface LegistarClient {
  client:   string;   // subdomain (e.g. "chicago")
  name:     string;
  state:    string;   // 2-digit FIPS
  fips5:    string;   // county FIPS-5
}

// Known major clients — extend from legistar.com/solutions/customers/
const LEGISTAR_CLIENTS: LegistarClient[] = [
  { client: 'chicago',      name: 'City of Chicago',         state: '17', fips5: '17031' },
  { client: 'losangeles',   name: 'Los Angeles County',      state: '06', fips5: '06037' },
  { client: 'houston',      name: 'City of Houston',         state: '48', fips5: '48201' },
  { client: 'phoenix',      name: 'City of Phoenix',         state: '04', fips5: '04013' },
  { client: 'seattle',      name: 'City of Seattle',         state: '53', fips5: '53033' },
  { client: 'denver',       name: 'City and County of Denver', state: '08', fips5: '08031' },
  { client: 'dallas',       name: 'City of Dallas',          state: '48', fips5: '48113' },
  { client: 'miami',        name: 'Miami-Dade County',       state: '12', fips5: '12086' },
  { client: 'boston',       name: 'City of Boston',          state: '25', fips5: '25025' },
  { client: 'atlanta',      name: 'City of Atlanta',         state: '13', fips5: '13121' },
  { client: 'lasvegas',     name: 'City of Las Vegas',       state: '32', fips5: '32003' },
  { client: 'sandiego',     name: 'City of San Diego',       state: '06', fips5: '06073' },
  { client: 'portland',     name: 'City of Portland',        state: '41', fips5: '41051' },
  { client: 'minneapolis',  name: 'City of Minneapolis',     state: '27', fips5: '27053' },
  { client: 'sanjose',      name: 'City of San Jose',        state: '06', fips5: '06085' },
  { client: 'sacramento',   name: 'City of Sacramento',      state: '06', fips5: '06067' },
  { client: 'milwaukee',    name: 'City of Milwaukee',       state: '55', fips5: '55079' },
  { client: 'louisville',   name: 'Louisville/Jefferson County', state: '21', fips5: '21111' },
  { client: 'omaha',        name: 'City of Omaha',           state: '31', fips5: '31055' },
  { client: 'raleigh',      name: 'City of Raleigh',         state: '37', fips5: '37183' },
  { client: 'coloradosprings', name: 'City of Colorado Springs', state: '08', fips5: '08041' },
  { client: 'tucson',       name: 'City of Tucson',          state: '04', fips5: '04019' },
  { client: 'fresno',       name: 'City of Fresno',          state: '06', fips5: '06019' },
  { client: 'clevelandohio', name: 'City of Cleveland',      state: '39', fips5: '39035' },
  { client: 'pittsburgh',   name: 'City of Pittsburgh',      state: '42', fips5: '42003' },
];

export async function seedLegistarEntities(db: AgendaWatchDb): Promise<void> {
  for (const client of LEGISTAR_CLIENTS) {
    const testUrl =
      `https://webapi.legistar.com/v1/${client.client}/Events?$top=1`;

    try {
      const res = await fetch(testUrl, {
        headers: { 'User-Agent': 'FaradayIntelligence/1.0 (research@faraday-intelligence.ai)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.warn(`Legistar ${client.client}: ${res.status} — skipping`);
        continue;
      }

      const { data: jRow } = await db
        .from('jurisdictions')
        .select('id')
        .eq('geo_key', client.fips5)
        .single();

      const { error } = await db.from('agenda_watch_entities').upsert(
        {
          entity_name:     client.name,
          entity_type:     'county',
          state_fips:      client.state,
          county_fips5:    client.fips5,
          cms_platform:    'Legistar',
          base_url:        `https://${client.client}.legistar.com`,
          agenda_url:      `https://${client.client}.legistar.com/Calendar.aspx`,
          api_client_id:   client.client,
          jurisdiction_id: (jRow as Record<string, unknown> | null)?.id ?? null,
          crawl_status:    'active',
        },
        { onConflict: 'base_url' },
      ).run();

      if (error) console.error(`Legistar upsert ${client.client}:`, error);
    } catch (e) {
      console.error(`Legistar client ${client.client} failed:`, e);
    }

    await new Promise(r => setTimeout(r, 200));
  }
}
