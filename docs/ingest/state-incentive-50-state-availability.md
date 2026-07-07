# State Incentive Disclosure Data — 50-State + DC Availability Matrix

**For:** CC-INGEST-STATE-INCENTIVE (JPAS T7 Incentives, INC-01..05). Compiled 2026-07-07 from
primary-source research (state government publications only; national aggregators like Good Jobs
First / Upjohn deliberately excluded). Endpoints marked **✓verified** were fetched live.

## Tiers
- **A** = machine-readable API or bulk file (Socrata/CKAN/ArcGIS JSON/CSV, or a downloadable Excel) — ingestable with a parser, no scraping.
- **B** = searchable web portal / HTML only — requires scraping (form-driven or table parse).
- **C** = PDF / narrative / FOIA-gated — requires PDF/OCR extraction or a records request.

## Headline
**True Tier-A recipient-level disclosure is rare.** Only ~8 jurisdictions expose a
machine-readable feed; the large majority are scrape (B) or PDF/FOIA (C). This confirms the v1
investigation-gate caution — a 50-state "API" ingestion is not achievable; most states are a
scrape/PDF follow-on. Recipient **company names are withheld** in several states (CO project code
names; HI anonymized productions; SC/TN jobs-credit programs confidential).

---

## Build order (recommended)

**Wave 1 — Tier-A drop-in API (extend the existing NY framework):**
- **NY** — Socrata `26ei-n4eb` — ✅ LIVE (65k rows, done)
- **CT** — Socrata `xnw3-nytd` — gold standard (recipient+county+**statute**+$)
- **OR** — Socrata `rvwj-m6ev` + `re77-krua` — property-tax abatement, incl. data-center deals
- **IA** — Iowa Data Hub API `idh-be.iowa.gov/api/v1/datasets/946/rows.csv` — credit $ + assistance $ + investment + jobs + county (richest confirmed after NY)
- **WI** — ArcGIS FeatureServer (`ImpactMap_featureSvc_Awards/0`) — 4,867 records
- **HI** — CKAN Film Tax Credit (narrow: film only, anonymized)

**Wave 2 — Tier-A bulk-file (download + parse Excel):**
- **TN** — OpenECD FastTrack `.xlsx` (640 rows) — scrape current href, load 12 cols
- **MN** — DEED Business Subsidy annual Excel (statutory MNBAF)
- **TX** — Comptroller Ch.313 agreement spreadsheets (+ Ch.403 JETI going forward)
- **DC** — ArcGIS layer 26 (structure) + OCFO page scrape (dollar amounts)

**Wave 3 — Tier-B scrape (→ CC-INGEST-STATE-INCENTIVE-SCRAPE-2.0):**
AL (clean HTML table), CA, PA, IL, NJ, MI, IN, KY, ID, NM, MT, CO, WA, + deferred GA/VA/AZ.

**Wave 4 — Tier-C PDF/FOIA (lowest yield, per-state effort):**
OH, LA, NV, SD, FL, MA, SC, WV, MS, AR, ME, AK, WY, ND.

---

## Full matrix

| State | Tier | Primary source | Access / endpoint | Recipient names? | Verified |
|---|---|---|---|---|---|
| NY | A | ESD Database of Economic Incentives | Socrata `data.ny.gov/resource/26ei-n4eb.json` | yes | ✓ LIVE |
| CT | A | DECD Business Assistance Portfolio | Socrata `data.ct.gov/resource/xnw3-nytd.json` (not the `94hg-qtnd` map view) | yes | ✓ |
| OR | A | Business Oregon EZ/SIP rolls | Socrata `data.oregon.gov/resource/rvwj-m6ev.json` + `re77-krua.json` | yes | ✓ |
| WI | A | WEDC Awards / Impact Map | ArcGIS `services2.arcgis.com/xkpZtaTA2F05Vq7i/.../ImpactMap_featureSvc_Awards/FeatureServer/0` | yes | ✓ |
| HI | A | DBEDT Film Tax Credit | CKAN `opendata.hawaii.gov` pkg `film-tax-credit` | anonymized | ✓ |
| TN | A(bulk) | TNECD OpenECD FastTrack DB | `.xlsx` off `tn.gov/ecd/resources/openecd/fasttrack-project-database.html` (640 rows) | yes | ✓ |
| TX | A(bulk) | Comptroller Ch.313 / Ch.403 JETI | `comptroller.texas.gov/economy/local/ch313/` spreadsheets; **no** data.texas.gov table | yes | ✓ |
| DC | A/B | OCFO TIF/PILOT | ArcGIS `maps2.dcgis.dc.gov/.../Business_Incentives_WebMercator/MapServer/26` + `cfo.dc.gov/page/active-tifs-and-pilots` | dev names (scrape) | ✓ |
| AL | B | Commerce "Incentives Records" (Jobs Act) | HTML table `madeinalabama.com/resources/public-records/incentives-records/` (67×11) | yes | ✓ |
| CA | B | GO-Biz California Competes Awardee List | HTML table `business.ca.gov/awardee-list/` (no CSV/API) | yes | ✓ |
| PA | B | DCED Investment Tracker | ASP.NET form `apps.grants.pa.gov/InvestmentTracker/DefaultDCED.aspx` | yes | ✓ |
| IL | B | DCEO EDGE Agreements | HTML `dceo.illinois.gov/.../edgeagreements.html` + per-co PDF; data.illinois.gov=0 datasets | yes | ✓ |
| NJ | B | NJEDA project lists (Grow NJ/ERG/BEIP…) | `njeda.gov/public_information/` PDFs; data.nj.gov ids are blobs | yes | ✓ |
| MI | B | MEDC Reports & Data | HTML `michiganbusiness.org/reports-data/<program>/` (city only) | yes | ✓ |
| IN | B | IEDC Transparency Portal + Gateway | `transparencyportal.iedc.in.gov` (PowerApps) + `gateway.ifionline.org` (abatement/TIF) | yes | ✓ |
| KY | B | KY Financial Incentives DB (CED/KEDFA) | portal `fisearch.ced.ky.gov` (no bulk/API) | yes | ✓ |
| ID | B | Commerce TRI Approved Projects | HTML `commerce.idaho.gov/.../approved-tri-projects/` | yes (some code) | ✓ |
| NM | B/C | EDD LEDA/JTIP Program Results | HTML tables FY24–25 `edd.newmexico.gov/.../program-results/`; PDFs older | yes | ✓ |
| MT | B/C | Commerce Big Sky EDTF | HTML `business.mt.gov/.../Job-Creation` (site migrating) | yes | ✓ |
| CO | B/C | OEDIT EDC monthly approvals | HTML `oedit.colorado.gov/news/...` (curl+UA) | **code names** | ✓ |
| WA | B | DOR Tax Incentive Public Disclosure | Tableau `dor.wa.gov/.../tax-incentive-public-disclosure-survey-data`; **not** on Socrata | yes | ✓ |
| OH | C | Dept of Development / Taxation reports | `development.ohio.gov` + Taxation PDFs (JobsOhio private) | partial | ✓ |
| LA | B/C | LED Board of Commerce & Industry (ITEP) | PDFs `opportunitylouisiana.gov/public-information/reports` | yes | ✓ |
| NV | C | GOED board packets + Controller GASB-77 | PDFs `goed.nv.gov` (company-level) + `controller.nv.gov` (county $, no names) | yes (PDF) | ✓ |
| SD | C | GOED Reinvestment Payment Program | PDFs `sdgoed.com/.../Public-Records-RPP-CY####.pdf` | yes | ✓ |
| ND | C | Commerce Business Incentive Accountability | PDFs `commerce.nd.gov/.../business-incentive-accountability` | partial | ✓ |
| WV | C | Tax Div. Tax Credit Review & Accountability | PDFs `tax.wv.gov/.../TaxCreditReview...`; recipient=FOIA | aggregate | ✓ |
| FL | B/C | FloridaCommerce Incentives Portal + Annual Report | Salesforce portal + PDF `floridajobs.org/.../annual-incentives-report.pdf` | yes (PDF) | ✓ |
| MA | C | EACC/EDIP Annual Report | PDF `malegislature.gov/Bills/194/HD5280.pdf` | yes | ✓ |
| SC | C | CCED Annual Report (Set-Aside grants) | PDF `sccommerce.com/.../CCED Annual Report` (JDC confidential) | yes (grants) | ✓ |
| MS | C | MDA Annual Report | PDF `mississippi.org/.../MDA-Annual-Report.pdf` (prose) | partial | ✓ |
| AR | C | AEDC Incentives Report / DFA | PDF (aggregate); recipient=FOIA | aggregate | ✓ |
| ME | C | DECD ETIF/PTDZ eval reports | PDF `maine.gov/decd/...` (data.maine.gov dead); recipient=FOAA | aggregate | ✓ |
| AK | C | AIDEA Annual Reports | PDF `aidea.org/.../Annual-Reports` (data.alaska.gov dead) | narrative | ✓ |
| WY | C | Business Council BRC Annual Report | PDF `wyomingbusiness.org/.../BRC-Annual-Report-YYYY.pdf` (**OCR**) + WyOpen | community-level | ✓ |
| IA | A | Iowa EDA "Economic Development Projects" (Under Contract + Closed) | Iowa Data Hub API `idh-be.iowa.gov/api/v1/datasets/946/rows.csv` (+`.json`) | yes | ✓ |
| MN | A(bulk) | DEED Business Subsidy Reports (MNBAF) | Annual Excel `mn.gov/deed/government/business-subsidy/biz-subsidy-annuals/` | yes | ✓ |
| MO | B | Missouri Accountability Portal — Tax Credits (§135.805) | `mapyourtaxes.mo.gov/map/taxcredits/` (daily-updated, no bulk export) | yes | ✓ |
| NC | C | NC Commerce JDIG / OneNC incentive reports | PDFs `commerce.nc.gov/reports-policymakers/incentive-programs-reports` | yes | ✓ |
| AZ | B? | Arizona Commerce Authority (Qualified Facility / data-center TPT); OpenBooks AZ | `openbooks.az.gov` candidate; **needs verification** | ? | ✗ UNVERIFIED |
| GA | C? | GA Dept of Economic Development / Dept of Revenue | weak disclosure; **needs verification** | ? | ✗ UNVERIFIED |
| VA | B? | VEDP (MEI/COIA / COF grant reporting) | data.virginia.gov Socrata candidate; **needs verification** | ? | ✗ UNVERIFIED |
| NE | C? | DOR Nebraska Advantage / ImagiNE annual reports | Revenue annual report PDFs; **needs verification** | ? | ✗ UNVERIFIED |
| OK | B? | Commerce / Quality Jobs; Incentive Evaluation Commission | okcommerce.gov; **needs verification** | ? | ✗ UNVERIFIED |
| UT | B? | GOEO EDTIF (post-performance credits) | business.utah.gov; **needs verification** | ? | ✗ UNVERIFIED |
| KS | B? | Commerce PEAK / Kansas Data | kansascommerce.gov; **needs verification** | ? | ✗ UNVERIFIED |
| MD | B? | Commerce / One Maryland; Open Data Maryland | opendata.maryland.gov; **needs verification** | ? | ✗ UNVERIFIED |
| DE | C? | DE Prosperity Partnership / Strategic Fund | dedo.delaware.gov; **needs verification** | ? | ✗ UNVERIFIED |
| RI | B? | RI Commerce (Rebuild RI, Qualified Jobs) | commerceri.com; **needs verification** | ? | ✗ UNVERIFIED |
| VT | C? | Vermont VEPC (VEGI) annual report | accd.vermont.gov; **needs verification** | ? | ✗ UNVERIFIED |
| NH | C? | NH BEA (ED tax credits) | nheconomy.com; **needs verification** | ? | ✗ UNVERIFIED |

**Coverage: 39 jurisdictions verified; 12 still UNVERIFIED** (AZ, GA, VA, NE, OK, UT, KS, MD, DE,
RI, VT, NH — several hit research rate-limits and need a second pass). The **AZ / GA / VA** gap
matters most (top data-center markets) and should be the first target of the next research pass —
probe `data.virginia.gov` (Socrata) and `openbooks.az.gov` before assuming Tier B/C.

**Verified Tier-A universe (9): NY (live), CT, OR, IA, WI, HI, TN, MN, DC** — these are the
achievable "API/bulk" ingestion set. Everything else is scrape (B) or PDF/FOIA (C), i.e. the
explicit out-of-scope follow-on for the API prompt.
