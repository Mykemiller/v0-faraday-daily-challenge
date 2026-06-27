export interface PucDirectory {
  state_fips:     string;
  state_abbr:     string;
  agency_name:    string;
  docket_url:     string;
  search_url:     string | null;
  api_available:  boolean;
  doc_format:     'pdf' | 'html' | 'both';
  access_pattern: 'search_form' | 'docket_list' | 'rss_feed' | 'open_api';
  notes:          string;
}

// Priority keywords for data-center-relevant docket filtering
export const PUC_DC_KEYWORDS = [
  'data center',
  'large load',
  'hyperscale',
  'special contract',
  'economic development rate',
  'load growth',
  'interconnection',
  'integrated resource plan',
  'IRP',
  'transmission expansion',
  'renewable energy certificate',
  'renewable portfolio standard',
  'power purchase agreement',
  'rate case',
  'tariff amendment',
  'large power',
  'industrial rate',
  'high-density load',
];

// Priority states — weekly crawl cadence (high DC activity or open API)
export const PRIORITY_STATE_FIPS = new Set([
  '48', // TX — most active DC market; PUCT Interchange API
  '51', // VA — world's largest DC cluster (Loudoun/Prince William)
  '13', // GA — Douglas County cluster; Georgia Power
  '37', // NC — Duke Carolinas; growing Chatham/Wake markets
  '12', // FL — FPL/Duke/Tampa Electric
  '17', // IL — ComEd Chicago metro
  '06', // CA — CPUC; SCE, PG&E, SDG&E
  '04', // AZ — ACC REST API; Phoenix metro DC demand
  '39', // OH — AEP/FirstEnergy; Columbus growing
  '42', // PA — PECO/PPL; PJM territory
]);

export const PUC_DIRECTORIES: PucDirectory[] = [
  // ── Tier-1 priority states ─────────────────────────────────────────────────
  {
    state_fips: '04', state_abbr: 'AZ',
    agency_name: 'Arizona Corporation Commission',
    docket_url: 'https://edocket.azcc.gov/api/public/dockets',
    search_url: 'https://edocket.azcc.gov/api/public/documents/search',
    api_available: true, doc_format: 'pdf', access_pattern: 'open_api',
    notes: 'REST API available — no key required. Best-in-class access. ' +
           'APS and TEP are primary utilities. Phoenix metro DC demand is high.',
  },
  {
    state_fips: '06', state_abbr: 'CA',
    agency_name: 'California Public Utilities Commission',
    docket_url: 'https://apps.cpuc.ca.gov/apex/f?p=401:56',
    search_url: 'https://apps.cpuc.ca.gov/apex/f?p=401:56:0::NO:RP',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'CPUC eDockets searchable by keyword. Very active — SCE, PG&E, SDG&E. ' +
           'High volume; filter aggressively by keyword.',
  },
  {
    state_fips: '12', state_abbr: 'FL',
    agency_name: 'Florida Public Service Commission',
    docket_url: 'https://www.floridapsc.com/filings/',
    search_url: 'https://www.floridapsc.com/filings/search',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Search by keyword. FPL, Duke FL, Tampa Electric are primary.',
  },
  {
    state_fips: '13', state_abbr: 'GA',
    agency_name: 'Georgia Public Service Commission',
    docket_url: 'https://psc.ga.gov/utilities/',
    search_url: 'https://psc.ga.gov/utilities/search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Georgia Power (Southern Company) is dominant. Douglas County ' +
           'data center cluster makes GA a priority state.',
  },
  {
    state_fips: '17', state_abbr: 'IL',
    agency_name: 'Illinois Commerce Commission',
    docket_url: 'https://www.icc.illinois.gov/dockets/',
    search_url: 'https://www.icc.illinois.gov/dockets/search',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'ComEd (Exelon) dominant in north. Data center activity in Chicago metro.',
  },
  {
    state_fips: '36', state_abbr: 'NY',
    agency_name: 'New York Public Service Commission',
    docket_url: 'http://documents.dps.ny.gov/public/MatterManagement/CaseMaster.aspx',
    search_url: 'http://documents.dps.ny.gov/public/Common/ViewDoc.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'NY DPS. ConEd, National Grid, NYSEG primary. ' +
           'Heavily constrained in NYC — moratorium-level capacity issues.',
  },
  {
    state_fips: '37', state_abbr: 'NC',
    agency_name: 'North Carolina Utilities Commission',
    docket_url: 'https://www.ncuc.net/dockets/',
    search_url: 'https://www.ncuc.net/dockets/search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Duke Energy Carolinas and Progress dominant. ' +
           'NC is a growing data center market (Chatham County, Wake County).',
  },
  {
    state_fips: '39', state_abbr: 'OH',
    agency_name: 'Public Utilities Commission of Ohio',
    docket_url: 'https://dis.puc.state.oh.us/CaseRecord.aspx',
    search_url: 'https://dis.puc.state.oh.us/TitlePage.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'AEP Ohio, FirstEnergy dominant. Columbus metro growing DC market.',
  },
  {
    state_fips: '42', state_abbr: 'PA',
    agency_name: 'Pennsylvania Public Utility Commission',
    docket_url: 'https://www.puc.pa.gov/filing_resources/searching_for_filings/',
    search_url: 'https://www.puc.pa.gov/search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'PECO (Exelon), PPL, West Penn Power. PJM territory — slow queues.',
  },
  {
    state_fips: '48', state_abbr: 'TX',
    agency_name: 'Public Utility Commission of Texas',
    docket_url: 'https://interchange.puc.texas.gov/Documents/browse.aspx',
    search_url: 'https://interchange.puc.texas.gov/Documents/search.aspx',
    api_available: true, doc_format: 'pdf', access_pattern: 'open_api',
    notes: 'PUCT Interchange has a documented API. ERCOT territory. ' +
           'Texas has the most active data center development in the US. ' +
           'Priority state — crawl weekly rather than monthly.',
  },
  {
    state_fips: '51', state_abbr: 'VA',
    agency_name: 'Virginia State Corporation Commission',
    docket_url: 'https://scc.virginia.gov/caselink/',
    search_url: 'https://scc.virginia.gov/caselink/search.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Dominion Energy Virginia dominant. Northern VA is the world\'s ' +
           'largest data center cluster — Loudoun County, Prince William County. ' +
           'Priority state — crawl weekly.',
  },

  // ── Remaining 39 states ────────────────────────────────────────────────────
  {
    state_fips: '01', state_abbr: 'AL',
    agency_name: 'Alabama Public Service Commission',
    docket_url: 'https://www.psc.state.al.us/GIS/Docket_Action.aspx',
    search_url: 'https://www.psc.state.al.us/GIS/Docket_Search.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Search by keyword. Major filer: Alabama Power (Southern Company).',
  },
  {
    state_fips: '02', state_abbr: 'AK',
    agency_name: 'Regulatory Commission of Alaska',
    docket_url: 'https://rca.alaska.gov/RCAWeb/RCALibrary/RCAOrders.aspx',
    search_url: 'https://rca.alaska.gov/RCAWeb/RCALibrary/SearchOrders.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'RCA handles electric and gas utilities. Small market; limited DC activity.',
  },
  {
    state_fips: '05', state_abbr: 'AR',
    agency_name: 'Arkansas Public Service Commission',
    docket_url: 'https://www.apscservices.info/EFilings/',
    search_url: 'https://www.apscservices.info/EFilings/search.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Entergy Arkansas and Southwestern Electric Power are primary utilities.',
  },
  {
    state_fips: '08', state_abbr: 'CO',
    agency_name: 'Colorado Public Utilities Commission',
    docket_url: 'https://www.dora.state.co.us/pls/efi/efi$efts100.select_case',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Docket list by year. Xcel Energy is primary. Denver metro DC buildout accelerating.',
  },
  {
    state_fips: '09', state_abbr: 'CT',
    agency_name: 'Connecticut Public Utilities Regulatory Authority',
    docket_url: 'https://www.dpuc.state.ct.us/pura.nsf',
    search_url: 'https://www.dpuc.state.ct.us/pura.nsf/search',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Eversource and United Illuminating serve CT. Moderate DC market.',
  },
  {
    state_fips: '10', state_abbr: 'DE',
    agency_name: 'Delaware Public Service Commission',
    docket_url: 'https://depsc.delaware.gov/formal-cases/',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Delmarva Power and Light is primary. Small state, limited DC activity.',
  },
  {
    state_fips: '15', state_abbr: 'HI',
    agency_name: 'Hawaii Public Utilities Commission',
    docket_url: 'https://puc.hawaii.gov/dockets/',
    search_url: 'https://puc.hawaii.gov/dockets/search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'HECO and subsidiaries. Isolated island grid; 100% RPS target. Unique market.',
  },
  {
    state_fips: '16', state_abbr: 'ID',
    agency_name: 'Idaho Public Utilities Commission',
    docket_url: 'https://puc.idaho.gov/case/',
    search_url: 'https://puc.idaho.gov/case/search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Idaho Power is primary. Growing data center market in Boise metro.',
  },
  {
    state_fips: '18', state_abbr: 'IN',
    agency_name: 'Indiana Utility Regulatory Commission',
    docket_url: 'https://iurc.portal.in.gov/cause-list/',
    search_url: 'https://iurc.portal.in.gov/cause-search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Duke Energy Indiana, AEP Indiana, NIPSCO. Data center presence in Indianapolis.',
  },
  {
    state_fips: '19', state_abbr: 'IA',
    agency_name: 'Iowa Utilities Board',
    docket_url: 'https://iub.iowa.gov/dockets/active',
    search_url: 'https://iub.iowa.gov/dockets/search',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'MidAmerican Energy (Berkshire) dominant. Iowa growing as DC market (100% renewable MidAmerican).',
  },
  {
    state_fips: '20', state_abbr: 'KS',
    agency_name: 'Kansas Corporation Commission',
    docket_url: 'https://www.kcc.ks.gov/dockets/',
    search_url: 'https://www.kcc.ks.gov/dockets/search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Evergy (Kansas City Power & Light, Westar). Limited DC market.',
  },
  {
    state_fips: '21', state_abbr: 'KY',
    agency_name: 'Kentucky Public Service Commission',
    docket_url: 'https://psc.ky.gov/pscecf/Documents/',
    search_url: 'https://psc.ky.gov/pscecf/Search/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'LG&E, KU, AEP Kentucky. Coal-heavy grid; DC activity limited.',
  },
  {
    state_fips: '22', state_abbr: 'LA',
    agency_name: 'Louisiana Public Service Commission',
    docket_url: 'https://lpscefiling.lpsc.la.gov/Search/Search.aspx',
    search_url: 'https://lpscefiling.lpsc.la.gov/Search/Search.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Entergy Louisiana dominant. New Orleans metro growing; hot+humid is a DC headwind.',
  },
  {
    state_fips: '23', state_abbr: 'ME',
    agency_name: 'Maine Public Utilities Commission',
    docket_url: 'https://mpuc-cms.maine.gov/CQS.DPU.Web/Cms/CaseIndex.aspx',
    search_url: 'https://mpuc-cms.maine.gov/CQS.DPU.Web/Cms/CaseSearch.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Central Maine Power and Versant Power. Cold climate favorable for DC; limited market.',
  },
  {
    state_fips: '24', state_abbr: 'MD',
    agency_name: 'Maryland Public Service Commission',
    docket_url: 'https://mdpscfilings.psc.state.md.us/eFiling/SearchMainPage.aspx',
    search_url: 'https://mdpscfilings.psc.state.md.us/eFiling/SearchMainPage.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'BGE and Pepco (Exelon). Prince George\'s County DC market adjacent to VA cluster.',
  },
  {
    state_fips: '25', state_abbr: 'MA',
    agency_name: 'Massachusetts Department of Public Utilities',
    docket_url: 'https://eeaonline.eea.state.ma.us/DPU/Fileroom/dockets/byNumber',
    search_url: 'https://eeaonline.eea.state.ma.us/DPU/Fileroom/dockets/byNumber',
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Eversource and National Grid. Boston metro has modest DC presence.',
  },
  {
    state_fips: '26', state_abbr: 'MI',
    agency_name: 'Michigan Public Service Commission',
    docket_url: 'https://efile.mpsc.state.mi.us/efile/searchl.php',
    search_url: 'https://efile.mpsc.state.mi.us/efile/searchl.php',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Consumers Energy and DTE Electric. Grand Rapids / Detroit markets.',
  },
  {
    state_fips: '27', state_abbr: 'MN',
    agency_name: 'Minnesota Public Utilities Commission',
    docket_url: 'https://efiling.puc.mn.gov/DocketSearch.aspx',
    search_url: 'https://efiling.puc.mn.gov/DocketSearch.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Xcel Energy (NSP) dominant. Minneapolis metro has growing DC market (cold climate).',
  },
  {
    state_fips: '28', state_abbr: 'MS',
    agency_name: 'Mississippi Public Service Commission',
    docket_url: 'https://www.psc.ms.gov/transportation/public-utility-filings',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Entergy Mississippi and Mississippi Power (Southern Company). Limited DC market.',
  },
  {
    state_fips: '29', state_abbr: 'MO',
    agency_name: 'Missouri Public Service Commission',
    docket_url: 'https://www.efis.psc.mo.gov/mpsc/commoncomponents/viewdoc.asp',
    search_url: 'https://www.efis.psc.mo.gov/mpsc/CommonComponents/SearchEFIS.asp',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Ameren Missouri and Evergy dominant. Kansas City metro is a growing DC market.',
  },
  {
    state_fips: '30', state_abbr: 'MT',
    agency_name: 'Montana Public Service Commission',
    docket_url: 'https://psc.mt.gov/Consumers/Dockets',
    search_url: 'https://psc.mt.gov/Consumers/DocketSearch',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'NorthWestern Energy dominant. Cold climate and low-cost hydro could attract DCs.',
  },
  {
    state_fips: '31', state_abbr: 'NE',
    agency_name: 'Nebraska Public Service Commission',
    docket_url: 'https://www.psc.nebraska.gov/electric/electric.html',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Mostly public power (NPPD, OPPD, LES). Omaha is a growing hyperscale DC market.',
  },
  {
    state_fips: '32', state_abbr: 'NV',
    agency_name: 'Nevada Public Utilities Commission',
    docket_url: 'https://pucweb1.state.nv.us/PUC_/home.aspx',
    search_url: 'https://pucweb1.state.nv.us/PUC_/search.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'NV Energy (Berkshire). Reno/Sparks is a major data center market ' +
           '(Switch, Apple, Google). Renewable portfolio active.',
  },
  {
    state_fips: '33', state_abbr: 'NH',
    agency_name: 'New Hampshire Public Utilities Commission',
    docket_url: 'https://www.puc.nh.gov/Regulatory/Docketbk.html',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Eversource NH and Liberty Utilities. Small state; limited DC market.',
  },
  {
    state_fips: '34', state_abbr: 'NJ',
    agency_name: 'New Jersey Board of Public Utilities',
    docket_url: 'https://publicaccess.bpu.state.nj.us/DocumentHandler.ashx',
    search_url: 'https://publicaccess.bpu.state.nj.us/CaseSummary.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'PSE&G and JCP&L dominant. Northern NJ has data center presence (Secaucus, Parsippany).',
  },
  {
    state_fips: '35', state_abbr: 'NM',
    agency_name: 'New Mexico Public Regulation Commission',
    docket_url: 'https://www.nmprc.state.nm.us/utilities/dockets.html',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'PNM Resources dominant. Albuquerque metro has modest DC presence; low-cost power appeal.',
  },
  {
    state_fips: '38', state_abbr: 'ND',
    agency_name: 'North Dakota Public Service Commission',
    docket_url: 'https://www.psc.nd.gov/electric/',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Montana-Dakota Utilities and Otter Tail. Very limited DC market.',
  },
  {
    state_fips: '40', state_abbr: 'OK',
    agency_name: 'Oklahoma Corporation Commission',
    docket_url: 'https://www.occeweb.com/EP/EP_Index.htm',
    search_url: 'https://www.occeweb.com/EP/EP_Index.htm',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'OG&E and PSO (AEP). Oklahoma City and Tulsa have growing DC presence.',
  },
  {
    state_fips: '41', state_abbr: 'OR',
    agency_name: 'Oregon Public Utility Commission',
    docket_url: 'https://apps.puc.oregon.gov/edockets/search.asp',
    search_url: 'https://apps.puc.oregon.gov/edockets/search.asp',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'PacifiCorp and Portland General Electric. Portland metro has data center activity; cheap hydro.',
  },
  {
    state_fips: '44', state_abbr: 'RI',
    agency_name: 'Rhode Island Public Utilities Commission',
    docket_url: 'https://www.ripuc.ri.gov/eventsactions/docket.html',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'National Grid RI. Very small state; minimal DC market.',
  },
  {
    state_fips: '45', state_abbr: 'SC',
    agency_name: 'South Carolina Public Service Commission',
    docket_url: 'https://dms.psc.sc.gov/Attachments/Orders/',
    search_url: 'https://dms.psc.sc.gov/web/',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Dominion Energy SC and Duke Energy Progress. Growing market (Greenville-Spartanburg).',
  },
  {
    state_fips: '46', state_abbr: 'SD',
    agency_name: 'South Dakota Public Utilities Commission',
    docket_url: 'https://puc.sd.gov/puc/electric/filings.aspx',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Xcel Energy and Black Hills. Limited DC market.',
  },
  {
    state_fips: '47', state_abbr: 'TN',
    agency_name: 'Tennessee Regulatory Authority',
    docket_url: 'https://tn.gov/tra/dockets.html',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'TVA serves most of TN — federal utility, separate docket system. ' +
           'TRA handles smaller IOUs. TVA filings at tvra.tva.gov.',
  },
  {
    state_fips: '49', state_abbr: 'UT',
    agency_name: 'Utah Public Service Commission',
    docket_url: 'https://pscdocs.utah.gov/electric/filings.htm',
    search_url: 'https://pscdocs.utah.gov/electric/search.htm',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Rocky Mountain Power (PacifiCorp). Salt Lake City / Lehi "Silicon Slopes" DC market.',
  },
  {
    state_fips: '50', state_abbr: 'VT',
    agency_name: 'Vermont Public Utility Commission',
    docket_url: 'https://epuc.vermont.gov/cases/open',
    search_url: 'https://epuc.vermont.gov/cases/search',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Green Mountain Power dominant. Very small state; minimal DC market.',
  },
  {
    state_fips: '53', state_abbr: 'WA',
    agency_name: 'Washington Utilities and Transportation Commission',
    docket_url: 'https://www.utc.wa.gov/casesandfilings/Pages/defaultUE.aspx',
    search_url: 'https://www.utc.wa.gov/casesandfilings/search.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Puget Sound Energy dominant. Eastern WA (Grant County PUD, ' +
           'Douglas County PUD) are key data center markets with cheap hydro.',
  },
  {
    state_fips: '54', state_abbr: 'WV',
    agency_name: 'West Virginia Public Service Commission',
    docket_url: 'https://www.psc.state.wv.us/script/caseinfo.cfm',
    search_url: 'https://www.psc.state.wv.us/script/caseinfo.cfm',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'Appalachian Power (AEP) and Monongalia Power. Limited DC market; coal-heavy grid.',
  },
  {
    state_fips: '55', state_abbr: 'WI',
    agency_name: 'Public Service Commission of Wisconsin',
    docket_url: 'https://apps.psc.wi.gov/apps10/ERF/ERFfilingResult.aspx',
    search_url: 'https://apps.psc.wi.gov/apps10/ERF/ERFfilingResult.aspx',
    api_available: false, doc_format: 'pdf', access_pattern: 'search_form',
    notes: 'We Energies and WPS. Milwaukee metro has limited DC activity.',
  },
  {
    state_fips: '56', state_abbr: 'WY',
    agency_name: 'Wyoming Public Service Commission',
    docket_url: 'https://psc.wyo.gov/home/dockets/',
    search_url: null,
    api_available: false, doc_format: 'pdf', access_pattern: 'docket_list',
    notes: 'Rocky Mountain Power (PacifiCorp). Very limited DC market; wind energy focus.',
  },
];
