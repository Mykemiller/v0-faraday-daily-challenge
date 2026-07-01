// Discover CivicPlus-hosted entities from the jurisdictions table.
// Strategy: for each county in a state, probe common URL patterns for the
// /AgendaCenter fingerprint that marks a CivicPlus installation.

import type { AgendaWatchDb, Row } from './db-client';

const STATE_ABBR: Record<string, string> = {
  '01': 'al', '02': 'ak', '04': 'az', '05': 'ar', '06': 'ca',
  '08': 'co', '09': 'ct', '10': 'de', '12': 'fl', '13': 'ga',
  '15': 'hi', '16': 'id', '17': 'il', '18': 'in', '19': 'ia',
  '20': 'ks', '21': 'ky', '22': 'la', '23': 'me', '24': 'md',
  '25': 'ma', '26': 'mi', '27': 'mn', '28': 'ms', '29': 'mo',
  '30': 'mt', '31': 'ne', '32': 'nv', '33': 'nh', '34': 'nj',
  '35': 'nm', '36': 'ny', '37': 'nc', '38': 'nd', '39': 'oh',
  '40': 'ok', '41': 'or', '42': 'pa', '44': 'ri', '45': 'sc',
  '46': 'sd', '47': 'tn', '48': 'tx', '49': 'ut', '50': 'vt',
  '51': 'va', '53': 'wa', '54': 'wv', '55': 'wi', '56': 'wy',
};

function stateAbbr(fips2: string): string {
  return STATE_ABBR[fips2] ?? 'us';
}

function candidateUrls(countyName: string, geoKey: string): string[] {
  const namePart = countyName
    .toLowerCase()
    .replace(/\scounty$/i, '')
    .replace(/\s+/g, '');
  const abbr = stateAbbr(geoKey.slice(0, 2));
  return [
    `https://www.${namePart}county.gov/AgendaCenter`,
    `https://${namePart}county.gov/AgendaCenter`,
    `https://www.co.${namePart}.${abbr}.us/AgendaCenter`,
    `https://www.${namePart}.${abbr}.gov/AgendaCenter`,
  ];
}

export async function discoverCivicPlusEntities(
  db: AgendaWatchDb,
  stateFips: string,
): Promise<void> {
  const { data: counties, error } = await db
    .from('jurisdictions')
    .select('id, name, geo_key')
    .eq('level', 'county')
    .like('geo_key', `${stateFips}%`)
    .run();

  if (error || !counties) {
    console.error(`CivicPlus seeder: jurisdictions fetch failed for state ${stateFips}:`, error);
    return;
  }

  for (const raw of counties) {
    const county = raw as Row & { id: string; name: string; geo_key: string };
    const urls   = candidateUrls(county.name, county.geo_key);

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          headers: {
            'User-Agent': 'FaradayIntelligence/1.0 (research@faraday-intelligence.ai)',
          },
        });

        if (!res.ok) continue;

        const baseUrl    = url.replace('/AgendaCenter', '');
        const { error: upsertErr } = await db.from('agenda_watch_entities').upsert(
          {
            entity_name:     county.name,
            entity_type:     'county',
            state_fips:      county.geo_key.slice(0, 2),
            county_fips5:    county.geo_key,
            cms_platform:    'CivicPlus',
            base_url:        baseUrl,
            agenda_url:      url,
            minutes_url:     `${url}?categoryID=0&meetingId=0&Type=2`,
            jurisdiction_id: county.id,
            crawl_status:    'active',
          },
          { onConflict: 'base_url' },
        ).run();

        if (upsertErr) console.error(`CivicPlus upsert ${county.name}:`, upsertErr);
        break;
      } catch {
        // URL not reachable — try next candidate
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }
}
