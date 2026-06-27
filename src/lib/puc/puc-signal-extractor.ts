// PUC signal extraction and JW/IDF integration.
// Uses raw Supabase REST API (no @supabase/supabase-js) to match repo convention.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

export type Svc = { base: string; headers: Record<string, string> };

export function getPucSvc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base: `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

// ── Signal pattern registry ───────────────────────────────────────────────────

type SignalType =
  | 'capacity_constraint'
  | 'capacity_expansion'
  | 'rate_increase'
  | 'rate_decrease'
  | 'dc_tariff'
  | 'large_load_approval'
  | 'irp_favorable'
  | 'irp_unfavorable'
  | 'renewable_commitment'
  | 'moratorium_power';

const SIGNAL_PATTERNS: Record<SignalType, RegExp[]> = {
  capacity_constraint: [
    /(?:capacity|generation).{0,50}(?:constrained|limited|insufficient|shortage)/i,
    /interconnection.{0,40}(?:queue|backlog|delay)/i,
    /cannot\s+accommodate|unable\s+to\s+serve/i,
    /capacity\s+(?:deficit|shortfall)/i,
  ],
  capacity_expansion: [
    /(?:new|additional).{0,30}(?:capacity|MW|megawatt)/i,
    /(?:approve|authorize).{0,40}(?:construction|installation)/i,
    /transmission\s+(?:upgrade|expansion|addition)/i,
    /capacity\s+(?:addition|procurement)/i,
  ],
  rate_increase: [
    /rate\s+(?:increase|adjustment).{0,30}\d+\.?\d*\s*%/i,
    /increase\s+in\s+(?:base|retail)\s+rates/i,
    /base\s+rate\s+increase/i,
  ],
  rate_decrease: [
    /rate\s+(?:decrease|reduction).{0,30}\d+\.?\d*\s*%/i,
    /decrease\s+in\s+(?:base|retail)\s+rates/i,
    /rate\s+relief/i,
  ],
  dc_tariff: [
    /data\s+center.{0,50}(?:tariff|rate|schedule)/i,
    /large\s+(?:load|power).{0,40}(?:tariff|contract|rate)/i,
    /economic\s+development\s+(?:rate|tariff)/i,
    /special\s+contract\s+(?:rate|customer)/i,
    /high.density\s+load/i,
  ],
  large_load_approval: [
    /(?:approve|grant).{0,40}large\s+(?:load|power|commercial)/i,
    /special\s+contract.{0,40}(?:approve|grant|execute)/i,
    /hyperscale.{0,40}(?:service|connect|approve)/i,
  ],
  irp_favorable: [
    /(?:IRP|integrated\s+resource\s+plan).{0,100}(?:capacity\s+addition|renewable|clean\s+energy)/i,
    /planned\s+(?:additions|capacity).{0,50}\d+\s*MW/i,
    /resource\s+plan.{0,60}(?:surplus|adequate)/i,
  ],
  irp_unfavorable: [
    /(?:IRP|integrated\s+resource\s+plan).{0,100}(?:constrained|shortfall|deficit)/i,
    /resource\s+adequacy.{0,50}(?:risk|concern|deficiency)/i,
    /capacity\s+shortfall.{0,50}\d+\s*MW/i,
  ],
  renewable_commitment: [
    /(?:100\s*%|net\s+zero|carbon.neutral).{0,60}(?:renewable|clean|energy)/i,
    /renewable\s+portfolio\s+standard/i,
    /power\s+purchase\s+agreement.{0,40}(?:wind|solar|renewable)/i,
  ],
  moratorium_power: [
    /moratorium.{0,40}(?:connection|service|interconnection)/i,
    /(?:suspend|halt|pause).{0,40}(?:new\s+(?:large\s+)?load|interconnection)/i,
    /unable\s+to\s+accept\s+new.{0,30}(?:load|customer)/i,
    /service\s+territory.{0,40}(?:saturated|full)/i,
  ],
};

// Sentiment: negative = grid headwind, positive = DC opportunity
const SIGNAL_SENTIMENT: Record<SignalType, number> = {
  capacity_constraint:  -0.6,
  capacity_expansion:   +0.7,
  rate_increase:        -0.3,
  rate_decrease:        +0.4,
  dc_tariff:            +0.5,
  large_load_approval:  +0.8,
  irp_favorable:        +0.6,
  irp_unfavorable:      -0.5,
  renewable_commitment: +0.5,
  moratorium_power:     -0.9,
};

const SIGNAL_DIMENSION: Record<SignalType, 'dim_power' | 'dim_incentives' | 'dim_regulatory'> = {
  capacity_constraint:  'dim_power',
  capacity_expansion:   'dim_power',
  rate_increase:        'dim_power',
  rate_decrease:        'dim_incentives',
  dc_tariff:            'dim_incentives',
  large_load_approval:  'dim_incentives',
  irp_favorable:        'dim_power',
  irp_unfavorable:      'dim_power',
  renewable_commitment: 'dim_power',
  moratorium_power:     'dim_regulatory',
};

// ── Extract signals from a filing's raw text ──────────────────────────────────

export async function extractPucSignals(
  filing: { id: string; state_fips: string },
  text: string,
  svc: Svc,
): Promise<number> {
  if (!text || text.length < 100) return 0;

  const signals: object[] = [];

  for (let i = 0; i < text.length; i += 400) {
    const window = text.slice(i, i + 600);

    for (const [sigType, patterns] of Object.entries(SIGNAL_PATTERNS) as [SignalType, RegExp[]][]) {
      if (!patterns.some(p => p.test(window))) continue;

      const mwMatch = window.match(/(\d[\d,]+)\s*MW/i);
      const magnitudeMw = mwMatch
        ? parseFloat(mwMatch[1].replace(/,/g, ''))
        : null;

      signals.push({
        filing_id:       filing.id,
        state_fips:      filing.state_fips,
        signal_type:     sigType,
        signal_text:     window.slice(0, 500),
        jps_dimension:   SIGNAL_DIMENSION[sigType],
        sentiment_score: SIGNAL_SENTIMENT[sigType],
        magnitude_mw:    magnitudeMw,
        idf_ingested:    false,
      });
      break; // one signal type per window
    }
  }

  if (signals.length > 0) {
    const res = await fetch(`${svc.base}/puc_signals`, {
      method: 'POST',
      headers: { ...svc.headers, Prefer: 'return=minimal' },
      body: JSON.stringify(signals),
    });
    if (!res.ok) {
      console.error(`insert puc_signals for filing ${filing.id}: ${res.status}`);
    }
  }
  return signals.length;
}

// ── Propagate PUC signals → jurisdictions dim_* columns ──────────────────────

export async function applyPucSignalsToJurisdictions(svc: Svc): Promise<void> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const res = await fetch(
    `${svc.base}/puc_signals?select=state_fips,jps_dimension,sentiment_score&extracted_at=gte.${since}`,
    { headers: svc.headers },
  );
  if (!res.ok) {
    console.error('applyPucSignalsToJurisdictions fetch:', res.status);
    return;
  }
  const signals: Array<{ state_fips: string; jps_dimension: string; sentiment_score: number | null }> =
    await res.json();

  // Average sentiment per state+dimension pair
  const groups = new Map<string, number[]>();
  for (const sig of signals) {
    const key = `${sig.state_fips}:${sig.jps_dimension}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sig.sentiment_score ?? 0);
  }

  for (const [key, scores] of groups.entries()) {
    const [stateFips, dimension] = key.split(':');
    const avgSentiment = scores.reduce((a, b) => a + b, 0) / scores.length;
    // Map sentiment [-1, +1] → JPS-compatible [1, 5]
    const dimValue = parseFloat(((avgSentiment + 1) / 2 * 4 + 1).toFixed(2));

    // Update state jurisdiction
    await fetch(
      `${svc.base}/jurisdictions?level=eq.state&geo_key=eq.${stateFips}`,
      {
        method: 'PATCH',
        headers: { ...svc.headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ [dimension]: dimValue }),
      },
    );

    // Backfill counties that lack a value (IS NULL guard preserves county-specific data)
    await fetch(
      `${svc.base}/jurisdictions?level=eq.county&geo_key=like.${stateFips}%25&${dimension}=is.null`,
      {
        method: 'PATCH',
        headers: { ...svc.headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ [dimension]: dimValue }),
      },
    );
  }

  console.log(`applyPucSignals: updated ${groups.size} state+dimension pairs`);
}

// ── Ingest un-sent PUC signals into idf_signals ───────────────────────────────

export async function ingestPucSignalsToIdf(svc: Svc): Promise<void> {
  const res = await fetch(
    `${svc.base}/puc_signals?idf_ingested=eq.false&select=*,puc_filings!inner(filing_type,filed_date,puc_dockets!inner(docket_title,utility_name))&limit=500`,
    { headers: svc.headers },
  );
  if (!res.ok) {
    console.error('ingestPucSignalsToIdf fetch:', res.status);
    return;
  }
  const signals: Array<Record<string, unknown>> = await res.json();
  if (signals.length === 0) return;

  const idfRecords = signals.map(sig => {
    const filing = sig.puc_filings as Record<string, unknown> | null;
    const docket = filing?.puc_dockets as Record<string, unknown> | null;
    return {
      source_type:     'state_puc_filing',
      source_id:       sig.id,
      raw_text:        sig.signal_text,
      signal_type:     sig.signal_type,
      jps_dimension:   sig.jps_dimension,
      sentiment_score: sig.sentiment_score,
      state_fips:      sig.state_fips,
      county_fips5:    sig.county_fips5 ?? null,
      metadata: {
        docket_title:  docket?.docket_title ?? null,
        utility_name:  docket?.utility_name ?? null,
        filed_date:    filing?.filed_date ?? null,
        magnitude_mw:  sig.magnitude_mw ?? null,
      },
    };
  });

  const insertRes = await fetch(`${svc.base}/idf_signals`, {
    method: 'POST',
    headers: { ...svc.headers, Prefer: 'return=minimal' },
    body: JSON.stringify(idfRecords),
  });
  if (!insertRes.ok) {
    console.error('ingestPucSignalsToIdf insert:', insertRes.status);
    return;
  }

  const ids = signals.map(s => s.id as string);
  await fetch(
    `${svc.base}/puc_signals?id=in.(${ids.map(id => `"${id}"`).join(',')})`,
    {
      method: 'PATCH',
      headers: { ...svc.headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ idf_ingested: true }),
    },
  );
  console.log(`PUC IDF: ${idfRecords.length} signals ingested`);
}
