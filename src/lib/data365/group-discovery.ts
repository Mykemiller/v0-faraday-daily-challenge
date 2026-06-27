// Group discovery — seeds data365_group_registry with relevant Facebook public
// groups for each county, using keyword templates across opposition/general/
// business themes. Intended as a one-time batch job (re-runnable, idempotent).
//
// Rate limit: Data365 allows ~60 req/min on standard plan; we pace at 1.2s/req.

import { searchGroups } from './client';
import { svc, dbSelect, dbUpsert } from './svc';

interface Jurisdiction {
  id:       string;
  name:     string;
  iso_code: string;   // FIPS-5 for counties — DB column is iso_code, not geo_key
}

type GroupTheme = 'opposition' | 'support' | 'general' | 'government' | 'business';

const SEARCH_TEMPLATES: Array<{ template: string; theme: GroupTheme }> = [
  // Opposition-specific
  { template: '{county} data center opposition',  theme: 'opposition' },
  { template: '{county} against data center',     theme: 'opposition' },
  { template: '{city} no data center',            theme: 'opposition' },
  { template: '{county} stop AI data center',     theme: 'opposition' },

  // General community (monitor for data center mentions)
  { template: '{county} community discussion',    theme: 'general' },
  { template: '{city} community news',            theme: 'general' },
  { template: '{county} residents',               theme: 'general' },

  // Local government / economic development
  { template: '{county} economic development',    theme: 'business' },
  { template: '{city} chamber of commerce',       theme: 'business' },
];

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function discoverGroupsForJurisdiction(
  jurisdiction: Jurisdiction,
): Promise<number> {
  const s = svc();
  const countyName = jurisdiction.name
    .replace(/ County$/i, '')
    .replace(/ Parish$/i, '');
  const countyRegex = new RegExp(countyName, 'i');

  let registered = 0;

  for (const tmpl of SEARCH_TEMPLATES) {
    const query = tmpl.template
      .replace('{county}', countyName)
      .replace('{city}', countyName);

    try {
      const groups = await searchGroups(query);

      for (const group of groups) {
        if ((group.members ?? 0) < 100) continue;
        if (!countyRegex.test(group.name)) continue;

        await dbUpsert(s, 'data365_group_registry', {
          jurisdiction_id:    jurisdiction.id,
          group_id:           group.id,
          group_name:         group.name,
          group_url:          `https://facebook.com/groups/${group.id}`,
          members_count:      group.members,
          discovery_keywords: [query],
          group_theme:        tmpl.theme,
          county_fips5:       jurisdiction.iso_code,
          state_fips:         jurisdiction.iso_code.slice(0, 2),
          is_active:          true,
        });
        registered++;
      }

      await sleep(1200);
    } catch (e) {
      console.error(`Group search failed for "${query}":`, e);
    }
  }

  return registered;
}

// Run discovery for all counties (batch job — takes several hours for full US).
// Pass stateFips (2-digit) to limit to one state for testing.
export async function discoverAllCountyGroups(stateFips?: string): Promise<void> {
  const s = svc();
  let params = 'level=eq.county&select=id,name,iso_code&order=name.asc';
  if (stateFips) params += `&iso_code=like.${stateFips}%25`;

  const counties = await dbSelect<Jurisdiction>(s, 'jurisdictions', params);

  let totalRegistered = 0;
  for (const county of counties) {
    const count = await discoverGroupsForJurisdiction(county);
    totalRegistered += count;
    console.log(
      `${county.name}: +${count} groups (running total: ${totalRegistered})`,
    );
  }

  console.log(`Group discovery complete: ${totalRegistered} groups registered`);
}
