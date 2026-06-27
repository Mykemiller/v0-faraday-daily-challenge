// Loads county-level Census ACS 5-year data into census_county_demographics.
// Census Bureau API is free — no key required for ACS 5-year endpoints.
// Rural-Urban Continuum Codes are from USDA ERS; partisan lean from MIT MEDSL.
// Call loadAllCountyDemographics() then storeDemographics() to populate the table.

import { getPgSvc, pgUpsert } from './supabase-client';

const CENSUS_API = 'https://api.census.gov/data';
const ACS_YEAR   = 2022;
// B01003_001E = total population
// B19013_001E = median household income
// B25001_001E = total housing units
// B08301_001E = total commuters
const ACS_VARS = 'B01003_001E,B19013_001E,B25001_001E,B08301_001E';

const STATE_FIPS = [
  '01','02','04','05','06','08','09','10','12','13',
  '15','16','17','18','19','20','21','22','23','24',
  '25','26','27','28','29','30','31','32','33','34',
  '35','36','37','38','39','40','41','42','44','45',
  '46','47','48','49','50','51','53','54','55','56',
];

export interface CountyDemographics {
  fips5:            string;
  state_fips:       string;
  population:       number;
  median_hh_income: number;
  housing_units:    number;
  commuters:        number;
  pop_density:      number | null;
  rural_urban_code: number | null;
  partisan_lean:    number | null;
}

async function fetchStateCounties(stateFips: string): Promise<CountyDemographics[]> {
  const url =
    `${CENSUS_API}/${ACS_YEAR}/acs/acs5` +
    `?get=${ACS_VARS},NAME` +
    `&for=county:*` +
    `&in=state:${stateFips}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API ${stateFips}: ${res.status}`);

  const rows: string[][] = await res.json();
  // Row 0 is the header; the state and county FIPS are the last two fields
  return rows.slice(1).map(row => ({
    fips5:            row[row.length - 2] + row[row.length - 1],
    state_fips:       row[row.length - 2],
    population:       parseInt(row[0]) || 0,
    median_hh_income: parseInt(row[1]) || 0,
    housing_units:    parseInt(row[2]) || 0,
    commuters:        parseInt(row[3]) || 0,
    pop_density:      null,
    rural_urban_code: null,
    partisan_lean:    null,
  }));
}

// USDA ERS Rural-Urban Continuum Codes (2023).
// Download from https://www.ers.usda.gov/webdocs/DataFiles/53251/ruralurbancodes2023.xlsx
// and pre-convert to CSV with columns: FIPS,RUCC_2023
// Place the CSV at public/data/rucc2023.csv or pass a URL via env RUCC_CSV_URL.
// Returns empty map if the source is unavailable (counties default to null).
async function fetchRuralUrbanCodes(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const url = process.env.RUCC_CSV_URL;
  if (!url) {
    console.warn('RUCC_CSV_URL not set — rural_urban_code will be null for all counties');
    return map;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RUCC fetch: ${res.status}`);
    const text = await res.text();
    for (const line of text.split('\n').slice(1)) {
      const [fips, code] = line.trim().split(',');
      if (fips && code) map.set(fips.trim(), parseInt(code.trim()));
    }
    console.log(`RUCC: loaded ${map.size} entries`);
  } catch (e) {
    console.error('RUCC load failed:', e);
  }
  return map;
}

// MIT Election Data + Science Lab county presidential results.
// Download from https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/VOQCHQ
// and pre-process to CSV with columns: county_fips,r_minus_d_pct
// (R_votes - D_votes) / total_votes * 100 from the most recent presidential election.
// Place at public/data/partisan-lean.csv or set PARTISAN_LEAN_CSV_URL.
// Returns empty map if unavailable (counties default to null).
async function fetchPartisanLean(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const url = process.env.PARTISAN_LEAN_CSV_URL;
  if (!url) {
    console.warn('PARTISAN_LEAN_CSV_URL not set — partisan_lean will be null for all counties');
    return map;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Partisan lean fetch: ${res.status}`);
    const text = await res.text();
    for (const line of text.split('\n').slice(1)) {
      const [fips, lean] = line.trim().split(',');
      if (fips && lean) map.set(fips.trim(), parseFloat(lean.trim()));
    }
    console.log(`Partisan lean: loaded ${map.size} entries`);
  } catch (e) {
    console.error('Partisan lean load failed:', e);
  }
  return map;
}

export async function loadAllCountyDemographics(): Promise<CountyDemographics[]> {
  const [rucc, partisan] = await Promise.all([
    fetchRuralUrbanCodes(),
    fetchPartisanLean(),
  ]);

  const all: CountyDemographics[] = [];

  for (const fips of STATE_FIPS) {
    try {
      const counties = await fetchStateCounties(fips);
      for (const c of counties) {
        c.rural_urban_code = rucc.get(c.fips5) ?? null;
        c.partisan_lean    = partisan.get(c.fips5) ?? null;
      }
      all.push(...counties);
      // Census API rate limit: ~500 req/day without a key
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      console.error(`State ${fips} census load failed:`, e);
    }
  }

  console.log(`Census: loaded demographics for ${all.length} counties`);
  return all;
}

export async function storeDemographics(counties: CountyDemographics[]): Promise<void> {
  const svc = getPgSvc();
  const BATCH = 500;
  for (let i = 0; i < counties.length; i += BATCH) {
    await pgUpsert(svc, 'census_county_demographics', counties.slice(i, i + BATCH), 'fips5');
  }
  console.log(`Census: stored ${counties.length} county rows`);
}
