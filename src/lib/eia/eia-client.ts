// EIA Open Data API v2 — endpoint patterns and fuel type mappings.
// Free key required: https://www.eia.gov/opendata/register.php
// Env: EIA_API_KEY

export const EIA_BASE = 'https://api.eia.gov/v2';

// Renewable fuel type IDs used by the electric-power-operational-data endpoint.
// sun = utility PV, dpv = distributed PV, wnd = wind, hyc = conventional hydro,
// geo = geothermal, www = wood/waste, was = municipal solid waste.
export const RENEWABLE_FUEL_IDS = new Set([
  'sun', 'dpv', 'wnd', 'hyc', 'geo', 'www', 'was',
]);

// Build EIA API URLs. The api_key query param is appended at fetch time to keep
// it out of logged strings.
export const EIA_ENDPOINTS = {
  stateGeneration: (stateAbbr: string, year: number): string =>
    `${EIA_BASE}/electricity/electric-power-operational-data/data/` +
    `?frequency=annual` +
    `&facets[location][]=${stateAbbr}` +
    `&facets[fueltypeid][]=ALL` +
    `&data[]=generation&data[]=capacity` +
    `&start=${year}&end=${year}` +
    `&sort[0][column]=period&sort[0][direction]=desc` +
    `&length=100`,

  plannedAdditions: (stateAbbr: string): string => {
    const nextYear = new Date().getFullYear() + 1;
    return (
      `${EIA_BASE}/electricity/operating-generator-capacity/data/` +
      `?facets[stateid][]=${stateAbbr}` +
      `&facets[status][]=P&facets[status][]=V&facets[status][]=T` +
      `&data[]=nameplate-capacity-mw` +
      `&start=${nextYear}&end=${nextYear + 3}` +
      `&length=500`
    );
  },
};

// FIPS-2 → state abbreviation for all 50 states + DC.
// Used to iterate EIA fetches (EIA uses state abbr, not FIPS).
// Jurisdictions table stores FIPS-2 in the iso_code column for state-level rows.
export const STATE_FIPS_TO_ABBR: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA',
  '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL',
  '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN',
  '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME',
  '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS',
  '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
  '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI',
  '56': 'WY',
};
