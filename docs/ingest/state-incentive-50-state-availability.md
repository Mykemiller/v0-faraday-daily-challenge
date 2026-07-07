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
- **MD** — Socrata `opendata.maryland.gov/resource/cf3i-xdgb.json` — 7,300 rows, recipient+county+city+type+$ (needs App Token)
- **OK** — CKAN `data.ok.gov/api/3/action/datastore_search?resource_id=d4845ba8-...` (Quality Jobs) + Tax Credits
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
| MD | A | MD Commerce Consolidated Finance Tracker (Socrata) | `opendata.maryland.gov/resource/cf3i-xdgb.json` (7,300 rows) + CITC `7gad-cuav` | recipient, county, city, type, program, approved_amount, jobs, NAICS, FY | ✓ (2nd pass) |
| OK | A | OK Tax Commission via `data.ok.gov` CKAN | `data.ok.gov/api/3/action/datastore_search?resource_id=d4845ba8-1caa-43fb-821c-b902d3520b06` (Quality Jobs, 4,324) + `...6c03762e-...` (Tax Credits) | vendor/name, city+zip (QJ), payment/credit $, program, FY (no county col) | ✓ (2nd pass) |
| VA | C | VEDP Incentives Reporting (COF/VIP/VEDIG/MEE/VJIP) | 8 program PDFs `vedp.org/incentives-reporting`. data.virginia.gov CKAN = boundary maps only (verified) | company, incentive $, jobs, capex, wage, clawback, locality | ✓ (2nd pass) |
| AZ | C | Arizona Commerce Authority statutory incentive reports | PDFs `azcommerce.com/about-us/incentive-reports/` (Quality Jobs/Qualified Facility/CDC; 403-to-bot). data.az.gov dead | recipient, city, credit/exemption $, jobs, compensation, program, statute | ✓ (2nd pass) |
| GA | C | GA Dept of Revenue data-center exemption (aggregate) | `dor.georgia.gov/data-centers-sales-use-tax-exemption-...` PDFs. **Recipient names legally suppressed** — FOIA only | county, threshold $ by pop-tier, year (NO recipient) | ✓ (2nd pass) |
| NE | C | NE Dept of Revenue Tax Incentives Annual Report (Advantage/ImagiNE) | PDF `revenue.nebraska.gov/.../2025_Incentives_Annual_Report.pdf` (+ ImagiNE joint reports) | company, project city, investment $M, FTEs, agreement year, program | ✓ (2nd pass) |
| KS | B | KS Commerce Transparency Database Explorer (K.S.A. 74-50,227) | `kansascommerce.gov/dataview/transparency-explorer-home/` (Directorist UI, Cloudflare-gated; no CSV/JSON) | program, **county**, recipient name, amount, year (>$50k) | ✓ (2nd pass) |
| UT | B | GOEO "Incented Companies" dashboard (EDTIF/REDTIF) | `business.utah.gov/recruitment/companies/` — Ninja Table id 71526 (ajax, CF-gated). data.utah.gov not Socrata | company, year, jobs, wages, capex, max incentive $, **term** (NO county) | ✓ (2nd pass) |
| RI | C | RI Division of Taxation Annual Tax Credit Disclosure Report | PDF `tax.ri.gov/.../FYE2025_Oct1CommerceCreditsReport.pdf` (clean: name+address+statute+$) | recipient, address, city→muni, program, statute, credit $ | ✓ (2nd pass) |
| VT | B | VEPC VEGI Annual Report + Socrata grants | VEGI PDF/XLS `accd.vermont.gov/.../vegi/annualreports` (403) + Socrata grants `data.vermont.gov/resource/xifk-zskz.json` (live) | VEGI: company, town/county, auth $, jobs, NAICS; grants: grantee, town, $ | ✓ (2nd pass) |
| DE | C | Council on Development Finance / Strategic Fund summaries | `data.delaware.gov` CDF assets are **PDF files (non-tabular)**; DEDO press releases | recipient, program, $, jobs (PDF-locked) | ✓ (2nd pass) |
| NH | C | NH BEA ERZ / R&D credits — **no online recipient disclosure** | No state open-data portal; ERZ/R&D recipients not published (records request only). Partial: CDFA CDIP (nonprofits) | none public at recipient level | ✓ (2nd pass) |

**Coverage: all 51 jurisdictions verified** (second pass 2026-07-07 closed the final 12).

**Verified Tier-A universe (11): NY (live), CT, OR, IA, WI, HI, TN, MN, DC, MD, OK** (+ TX bulk
Excel) — the achievable "API/bulk" ingestion set. Everything else is scrape (B) or PDF/FOIA (C),
the explicit out-of-scope follow-on for the API prompt.

**Top data-center markets are all PDF/scrape, not API:** VA (VEDP PDFs), AZ (ACA PDFs), GA
(**recipient names legally suppressed** — aggregate/FOIA only). Plan for per-state PDF parsing +
FOIA there; there is no shortcut feed.
