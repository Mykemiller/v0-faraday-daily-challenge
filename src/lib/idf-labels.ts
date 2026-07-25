// Canonical IDF 4.0 label mapping (FAR-387).
//
// THE single source of truth that turns internal IDF codes into the
// plain-language names a subscriber is allowed to see. No subscriber-facing
// surface may ever render a raw D-code or T-code (see the guard test in
// `idf-labels.test.ts`); route the value through the resolvers here instead.
//
// Codes come from the IDF 4.0 registry snapshot
// (`scripts/far287/idf-taxonomy-snapshot.json`):
//   - Domains  = "sectors"  → D1..D23  (DOMAIN_LABELS)
//   - Themes   = "theaters" → T-001..T-007  (THEME_LABELS)
//
// Design rules (locked, FAR-387):
//   D3  Display format is `Domain: {name} | Theme: {name}` (see formatDomainTheme).
//   D4  Fallback: an unmapped CODE renders NOTHING for that slot — never the raw
//       code, never an empty label. A value that is already a plain name (not a
//       code) passes through unchanged.

/** Domain code → plain-language domain name. Frozen: this is the contract. */
export const DOMAIN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  D1: "Chips & Density",
  D2: "Power Architecture",
  D3: "Grid & Regulatory",
  D4: "M&A & Capital Markets",
  D5: "Hyperscaler Activity",
  D6: "New Entrants",
  D7: "Cooling & Water Technology",
  D8: "People & Signals",
  D9: "Orchestration Intelligence & Control Plane",
  D10: "Construction",
  D11: "Sustainability",
  D12: "Networking & Interconnect",
  D13: "Community Relations",
  D14: "Real Estate & Site Selection",
  D15: "Sovereign AI & Geopolitics",
  D16: "Cyber & Physical Security and Resilience",
  D17: "Workforce & Labor Markets",
  D18: "Community Opposition & Regulatory Risk",
  D19: "Tax, Incentives & Fiscal Policy",
  D20: "Facility IT & Operational Technology",
  D21: "Insurance & Risk Markets",
  D22: "Industry Media & Analyst Coverage",
  D23: "Outage Intelligence & Emergency Response",
});

/** Theme (theater) code → plain-language theme name. Frozen: this is the contract. */
export const THEME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "T-001": "The Power Reckoning",
  "T-002": "The Thermal Reckoning",
  "T-003": "The Consent Crisis",
  "T-004": "The Capital Concentration",
  "T-005": "The Inference Economy",
  "T-006": "The Sovereign AI Race",
  "T-007": "The New Energy Stack",
});

// A bare domain code (D2) or sub-domain code (D2.5). Sub-domain codes resolve to
// their PARENT domain name so a "D2.5" never leaks to a subscriber.
const DOMAIN_CODE_RE = /^D(\d+)(?:\.\d+)?$/i;
// A theme/theater code in any of the forms T-001 / T001 / T1.
const THEME_CODE_RE = /^T-?0*(\d+)$/i;

/**
 * Resolve a domain value for subscriber display.
 * - a mapped code (D2 or sub-domain D2.5) → the plain domain name
 * - an UNMAPPED code (e.g. "D99")         → null  (D4: render nothing)
 * - a value that is not a code            → returned unchanged (already a name)
 * - null / empty                          → null
 */
export function resolveDomainName(value: string | null | undefined): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return null;
  const m = v.match(DOMAIN_CODE_RE);
  if (m) return DOMAIN_LABELS[`D${m[1]}`] ?? null; // code path — never fall back to the raw code
  return v; // already a plain-language name
}

/**
 * Resolve a theme value for subscriber display. Same rules as resolveDomainName,
 * accepting theme codes in the forms T-001 / T001 / T1.
 */
export function resolveThemeName(value: string | null | undefined): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return null;
  const m = v.match(THEME_CODE_RE);
  if (m) {
    const key = `T-${m[1].padStart(3, "0")}`;
    return THEME_LABELS[key] ?? null; // code path — never fall back to the raw code
  }
  return v; // already a plain-language name
}

/**
 * Build the locked `Domain: {name} | Theme: {name}` display string (D3), omitting
 * any slot whose value has no mapping (D4). Returns null when neither slot renders,
 * so callers can hide the row entirely rather than show an empty label.
 */
export function formatDomainTheme(input: {
  domain?: string | null;
  theme?: string | null;
}): string | null {
  const parts: string[] = [];
  const domainName = resolveDomainName(input.domain);
  if (domainName) parts.push(`Domain: ${domainName}`);
  const themeName = resolveThemeName(input.theme);
  if (themeName) parts.push(`Theme: ${themeName}`);
  return parts.length ? parts.join(" | ") : null;
}
