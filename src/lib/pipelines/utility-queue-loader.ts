// Loads RTO interconnection queue data and derives county-level power availability scores.
// All RTO queue sources are public regulatory disclosures — no API keys required.
// Call seedCountyPowerAvailability() after EIA 861 utility-county map is loaded.

import { getPgSvc, pgUpsert } from './supabase-client';

export interface RtoQueueSource {
  rto:    string;
  name:   string;
  url:    string;
  format: 'csv' | 'xlsx' | 'json';
  notes:  string;
}

export const RTO_QUEUE_SOURCES: RtoQueueSource[] = [
  {
    rto:    'MISO',
    name:   'Midcontinent Independent System Operator',
    url:    'https://www.misoenergy.org/planning/generator-interconnection/GI_Queue/',
    format: 'xlsx',
    notes:  'Covers IL, IN, IA, KS, MI, MN, MO, MT, ND, SD, WI, AR, LA, MS, TX (small). ' +
            'Download "Active Queue" Excel file.',
  },
  {
    rto:    'PJM',
    name:   'PJM Interconnection',
    url:    'https://www.pjm.com/planning/interconnection-energy-management/interconnection-queues',
    format: 'xlsx',
    notes:  'Covers DE, IL, IN, KY, MD, MI, NJ, NC, OH, PA, TN, VA, WV, DC. ' +
            'Largest US queue — ~2,000+ active projects, often 3–5 year waits.',
  },
  {
    rto:    'ERCOT',
    name:   'Electric Reliability Council of Texas',
    url:    'https://www.ercot.com/gridinfo/resource',
    format: 'xlsx',
    notes:  'Covers ~90% of Texas. Fastest large RTO — median ~18 months.',
  },
  {
    rto:    'CAISO',
    name:   'California Independent System Operator',
    url:    'https://www.caiso.com/planning/Pages/GeneratorInterconnection/Default.aspx',
    format: 'xlsx',
    notes:  'Covers most of California. 5+ year waits common in Bay Area / LA Basin.',
  },
  {
    rto:    'SPP',
    name:   'Southwest Power Pool',
    url:    'https://www.spp.org/engineering/generator-interconnection/queue/',
    format: 'csv',
    notes:  'Covers KS, NE, OK, SD, NM, parts of TX/ND/WY/MT/MN/IA/MO/LA/AR.',
  },
  {
    rto:    'NYISO',
    name:   'New York Independent System Operator',
    url:    'https://www.nyiso.com/interconnections',
    format: 'xlsx',
    notes:  'Covers New York State. NYC and Long Island are severely constrained.',
  },
  {
    rto:    'ISO-NE',
    name:   'ISO New England',
    url:    'https://www.iso-ne.com/isoexpress/web/reports/operations/-/tree/generator-interconnection-request-queue',
    format: 'xlsx',
    notes:  'Covers CT, ME, MA, NH, RI, VT. Very constrained — particularly southern NE.',
  },
  {
    rto:    'WECC',
    name:   'Western Electricity Coordinating Council (non-CA)',
    url:    'https://www.wecc.org/Reliability/Interconnection%20Queue%20Data.xlsx',
    format: 'xlsx',
    notes:  'Covers AZ, CO, ID, MT, NV, NM, OR, UT, WA, WY.',
  },
  {
    rto:    'SERC',
    name:   'SERC Reliability Corporation (non-PJM Southeast)',
    url:    'https://www.sercc.com/planning',
    format: 'xlsx',
    notes:  'Covers AL, FL, GA, KY, MS, NC, SC, TN, VA (portions not in PJM).',
  },
];

// RTO to primary state FIPS coverage (used to assign counties when utility map is unavailable)
export const RTO_STATE_MAP: Record<string, string[]> = {
  'MISO':   ['17','18','19','20','26','27','29','30','38','46','55','05','22','28'],
  'PJM':    ['10','17','18','21','24','26','34','37','39','42','47','51','54','11'],
  'ERCOT':  ['48'],
  'CAISO':  ['06'],
  'SPP':    ['20','31','40','46','35','08','56','30','27','19','29','22','05'],
  'NYISO':  ['36'],
  'ISO-NE': ['09','23','25','33','44','50'],
  'WECC':   ['04','08','16','30','32','35','41','49','53','56'],
  'SERC':   ['01','12','13','21','28','37','45','47','51'],
};

// Default median wait times (months) by RTO — used when live queue data is unavailable.
// Calibrated from FERC/RTO public queue reports as of 2024.
export const DEFAULT_WAIT_MONTHS: Record<string, number> = {
  'ERCOT':  18,
  'SPP':    24,
  'MISO':   30,
  'SERC':   30,
  'WECC':   36,
  'PJM':    52,
  'NYISO':  54,
  'ISO-NE': 58,
  'CAISO':  64,
};

// State FIPS → RTO assignment (derived from RTO_STATE_MAP; states in multiple RTOs
// take the dominant one by covered territory)
const STATE_RTO: Record<string, string> = {};
for (const [rto, states] of Object.entries(RTO_STATE_MAP)) {
  for (const s of states) {
    // First-match wins for overlapping states
    if (!STATE_RTO[s]) STATE_RTO[s] = rto;
  }
}

export function computePowerAvailability(params: {
  rtoIso:             string;
  queueWaitMonths:    number;
  availableCapacityMw: number | null;
  renewablePct:       number;
  transmissionStatus: 'none' | 'moderate' | 'severe' | 'critical';
}): { grid_access_score: number; power_tier: string } {
  const waitScore =
    params.queueWaitMonths <= 12  ? 40 :
    params.queueWaitMonths <= 24  ? 32 :
    params.queueWaitMonths <= 36  ? 22 :
    params.queueWaitMonths <= 48  ? 12 :
    params.queueWaitMonths <= 60  ? 6  : 2;

  const capScore =
    params.availableCapacityMw === null   ? 15 :
    params.availableCapacityMw >= 500     ? 35 :
    params.availableCapacityMw >= 200     ? 28 :
    params.availableCapacityMw >= 100     ? 20 :
    params.availableCapacityMw >= 50      ? 12 :
    params.availableCapacityMw >= 10      ? 6  : 2;

  const renewScore =
    params.renewablePct >= 60 ? 15 :
    params.renewablePct >= 40 ? 12 :
    params.renewablePct >= 20 ? 8  :
    params.renewablePct >= 10 ? 5  : 2;

  const transmissionPenalty =
    params.transmissionStatus === 'none'     ? 0  :
    params.transmissionStatus === 'moderate' ? 3  :
    params.transmissionStatus === 'severe'   ? 7  : 10;

  const grid_access_score = Math.max(0, Math.min(100,
    waitScore + capScore + renewScore - transmissionPenalty
  ));

  const power_tier =
    grid_access_score >= 80 ? 'Abundant'  :
    grid_access_score >= 60 ? 'Available' :
    grid_access_score >= 40 ? 'Adequate'  :
    grid_access_score >= 20 ? 'Tight'     : 'Constrained';

  return { grid_access_score, power_tier };
}

// Derive RTO for a county from its state FIPS prefix.
export function rtoForCounty(fips5: string): string | null {
  const stateFips = fips5.slice(0, 2);
  return STATE_RTO[stateFips] ?? null;
}

interface CountyPowerRow {
  fips5:                  string;
  rto_iso:                string | null;
  utility_name:           string | null;
  queue_wait_months:      number;
  available_capacity_mw:  number | null;
  renewable_pct:          number;
  transmission_constraint: string;
  grid_access_score:      number;
  power_tier:             string;
  source:                 string;
}

// Seed county_power_availability using RTO defaults.
// For production: replace DEFAULT_WAIT_MONTHS with live queue snapshot data
// and EIA state-level renewable generation via the EIA open-data API
// (https://api.eia.gov/v2/electricity/ — free key at https://www.eia.gov/opendata/).
//
// The fips5 list should come from census_county_demographics (all ~3,143 US counties).
export async function seedCountyPowerAvailability(fips5List: string[]): Promise<number> {
  const svc = getPgSvc();

  const rows: CountyPowerRow[] = fips5List.map(fips5 => {
    const rto  = rtoForCounty(fips5);
    const wait = rto ? (DEFAULT_WAIT_MONTHS[rto] ?? 36) : 36;

    const { grid_access_score, power_tier } = computePowerAvailability({
      rtoIso:             rto ?? 'unknown',
      queueWaitMonths:    wait,
      availableCapacityMw: null,   // unknown until live queue data is loaded
      renewablePct:       20,      // conservative default; replaced by EIA data in production
      transmissionStatus: 'none',  // default — no transmission constraint assumed without data
    });

    return {
      fips5,
      rto_iso:                 rto,
      utility_name:            null,
      queue_wait_months:       wait,
      available_capacity_mw:   null,
      renewable_pct:           20,
      transmission_constraint: 'none',
      grid_access_score,
      power_tier,
      source:                  'rto_default_wait_times',
    };
  });

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    await pgUpsert(svc, 'county_power_availability', rows.slice(i, i + BATCH), 'fips5');
  }

  console.log(`Power availability: seeded ${rows.length} counties`);
  return rows.length;
}
