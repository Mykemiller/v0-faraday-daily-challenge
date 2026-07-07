# CC-INGEST-STATE-INCENTIVE-API-1.1 — Pending-State Adapters

**Parent:** `CC-INGEST-STATE-INCENTIVE-API-1.0` (INC-01..05, JPAS T7). Inherits its table
(`state_incentive_disclosures`), RPC (`fn_state_incentives_resolve_and_score`), registry rows,
SRC confidence, content-hash idempotency, and GJF-precedence rule. **This is the follow-on that
builds the adapters left as `pending_source_confirmation` in v1**, plus reprioritizes based on
verified source research (2026-07-07).

> **AUTO-ID:** reuse **AUTO-178** (`ingest-state-incentives`). No new automation id.

---

## Headline finding (changes the plan)

The v1 prompt assumed TX/WA/IL/OH/NJ/LA were "API" states. **Verified research shows they are not.**
Of the six, **none exposes a clean queryable recipient-level API.** Four are scrape/PDF; TX is a
bulk-file download; WA is a Tableau webapp. Meanwhile the research surfaced **three genuinely clean
Tier-A states the original list missed** — **CT, WI, OR** — that drop straight into the existing
NY-style API framework.

**Recommendation (needs sign-off):** pull **CT + WI + OR** forward as the next *live API adapters*
(cheap, same pattern as NY, and OR/WI carry data-center deals), and move IL/OH/NJ/LA into the
**V2 scrape track** alongside GA/VA/AZ. TX (bulk Excel) and WA (webapp) sit in between.

---

## Mandatory investigation gate (per state, before writing its adapter)

- **J1 — Endpoint liveness:** re-fetch the endpoint below and confirm it still returns rows / the
  file still downloads (state portals churn). Record the row count.
- **J2 — Field map:** confirm the exact field names (they drift) and map to the common schema
  (recipient_name, county_name/place_name, incentive_type, program_name, statute_citation,
  award_value_usd, term_start/end).
- **J3 — Jurisdiction grain:** confirm whether the source gives county, municipality, or only city
  (needs geocode). NY resolved at county; CT/WI carry county+municipality; OR gives county; the
  scrape states often give city only.
- **J4 — Volume & cadence:** confirm total rows (to size the cursor `pages`) and refresh frequency.

---

## Verified source matrix for the six pending states

| State | Real tier | Primary source | Endpoint / access | Key fields | Adapter type |
|---|---|---|---|---|---|
| **TX** | A-bulk | Comptroller Ch.313 (expired 2022) active/inactive agreements + successor Ch.403 JETI; TIF & Local Development Agreement DBs | `comptroller.texas.gov/economy/local/ch313/` (agreement lists + Excel/PDF); data.texas.gov has **no** recipient-level table (verified) | company, ISD/location, limitation value, term, jobs | Download + parse Excel/CSV (not a JSON API) |
| **WA** | B (webapp) | WA DOR "Tax Incentive Public Disclosure" survey data | `dor.wa.gov/.../tax-incentive-public-disclosure-survey-data` (Tableau, nightly refresh). **Not** on data.wa.gov Socrata (catalog = 0, verified) | recipient, disclosable $ value of preference, program, year | Reverse the Tableau data feed, else scrape |
| **IL** | B (scrape) | DCEO EDGE Agreements (Corp. Accountability for Tax Expenditures Act) | `dceo.illinois.gov/expandrelocate/incentives/edgeagreements.html` (HTML index → per-company redacted PDF). data.illinois.gov = 0 incentive datasets (verified) | company, location, credit value, term, jobs, capex | HTML index + PDF parse |
| **OH** | C | Ohio Dept. of Development / Tax Credit Authority + Dept. of Taxation "Business Tax Credits" reports (JobsOhio is private) | `development.ohio.gov` program pages; Taxation annual-report PDFs. No Tier-A dataset found | company, program, credit value, jobs, county (uneven) | PDF table extraction (weakest state) |
| **NJ** | B (scrape) | NJEDA project lists (Grow NJ / ERG / BEIP / BRRAG / Emerge-Aspire) + Completed & Certified | `njeda.gov/public_information/` project-list PDFs. data.nj.gov EDA ids `rapr-2pdi`, `xap9-x2qd` are **blob PDFs**, no SODA API (verified) | company, city+county, program, award value, term, jobs, capex | Fetch stable per-program PDFs; table-extract |
| **LA** | B/C | LED Board of Commerce & Industry incentive approval reports (ITEP) | `opportunitylouisiana.gov/public-information/reports` (per-year approval PDFs). No CSV/API | company+contact, parish, program (ITEP), incentive value, term | PDF parse; attribute by parish; verify post-2017 coverage |

## Higher-priority Tier-A additions (drop-in to the v1 API framework)

| State | Endpoint (verified live) | Key fields | Notes |
|---|---|---|---|
| **CT** | Socrata `https://data.ct.gov/resource/xnw3-nytd.json` (+`.csv`) — **use `xnw3-nytd` dataset, NOT the `94hg-qtnd` map view (returns empty via API)** | `company_name, company_address, municipality, county_1, funding_source`(program)`, statutory_reference, grant_amount, loan_amount, total_assistance, contract_execution_date, jobs` | Gold standard: recipient+county+type+$+program+**statute** natively. Near-identical to NY adapter. |
| **WI** | ArcGIS FeatureServer `https://services2.arcgis.com/xkpZtaTA2F05Vq7i/arcgis/rest/services/ImpactMap_featureSvc_Awards/FeatureServer/0/query?where=1=1&outFields=*&f=json` — **4,867 records verified**, paginate `resultOffset`/`resultRecordCount` (max 2000) | `awardRecipient, awardType, awardProgram, awardAmount, projectCost, county, municipality, awardYear, jobsToBeCreated` | New adapter *shape* (ArcGIS, not Socrata) — worth a reusable ArcGIS fetch helper. |
| **OR** | Socrata `https://data.oregon.gov/resource/rvwj-m6ev.json` (EZ business projects, 287 rows) + `re77-krua.json` (rural long-term / data-center SIP, incl. Facebook/Vitesse) | `name_of_qualified_business, oregon_county, enterprise_zone_name, property_taxes_abated_6, exemption_period_years_2, year_s_exemption_s_began` | Property-tax abatement grain; data-center relevant. |

## Build scope (this CC)
1. Add a reusable **Socrata adapter helper** (parameterize domain + resource id + field map) — CT
   and OR are then a few lines each; NY can be refactored onto it.
2. Add an **ArcGIS FeatureServer adapter helper** for WI (`resultOffset` paging, `f=json`).
3. Add a **bulk-file adapter** path (download Excel/CSV → parse) for TX.
4. Flip CT/WI/OR to `status:"live"` with confirmed field maps; run the cursor drain + verify
   INC-01..05 writes exactly as NY was verified.
5. Leave IL/OH/NJ/LA/WA as `pending` here and hand them to the **V2 scrape prompt**
   (`CC-INGEST-STATE-INCENTIVE-SCRAPE-2.0`) — PDF/HTML extraction is explicitly out of scope for
   an "API/structured-disclosure" prompt.

## Out of scope (→ V2 scrape prompt)
PDF/HTML scraping states: IL, OH, NJ, LA, WA, MI, IN, NV, KY, CO, CA, FL, PA, MA, and the Tier-B/C
long tail. GA/VA/AZ remain the originally-deferred scrape targets. See
`state-incentive-50-state-availability.md` for the full tiering.
