// CMS platform patterns for US local government agenda/minutes discovery.
// Based on Big Local News / AgendaWatch methodology — six platforms cover ~95%
// of US local governments.

export interface CmsPattern {
  name:         string;
  marketShare:  string;
  discoveryUrl: string;
  apiEndpoint:  string | null;
  docFormat:    'pdf' | 'html' | 'both';
  notes:        string;
}

export const CMS_PATTERNS: CmsPattern[] = [
  {
    name:        'CivicPlus',
    marketShare: '~35%',
    discoveryUrl: 'https://{domain}/AgendaCenter',
    apiEndpoint:  'https://{domain}/AgendaCenter/ViewFile/Agenda/{id}',
    docFormat:    'pdf',
    notes:
      'Largest platform. Agendas at /AgendaCenter. ' +
      'Minutes at /AgendaCenter with type=2. ' +
      'Meeting list JSON at /Home/ShowPublishedAgendasJson. ' +
      'No auth required for public meetings.',
  },
  {
    name:        'Granicus / Legistar',
    marketShare: '~25%',
    discoveryUrl: 'https://{domain}.legistar.com/Calendar.aspx',
    apiEndpoint:  'https://webapi.legistar.com/v1/{client}/Events',
    docFormat:    'both',
    notes:
      'Legistar has a documented public REST API. ' +
      'GET /v1/{client}/Events returns all meetings with document links. ' +
      'GET /v1/{client}/EventItems/{id}/EventItemMatterAttachments ' +
      'returns attached minutes PDFs. Client name = subdomain.',
  },
  {
    name:        'Municode',
    marketShare: '~15%',
    discoveryUrl: 'https://municode.com/library/{state}/{city}',
    apiEndpoint:  null,
    docFormat:    'html',
    notes:
      'HTML minutes embedded in Municode Library. ' +
      'Scrape /library/{state}/{city}/docs?nodeId=MICO for minutes index.',
  },
  {
    name:        'BoardDocs',
    marketShare: '~10%',
    discoveryUrl: 'https://www.boarddocs.com/{state}/{entity}/Board.nsf/Public',
    apiEndpoint:  'https://www.boarddocs.com/{state}/{entity}/Board.nsf/RJSON',
    docFormat:    'html',
    notes:
      'JSON API available. GET /RJSON?open returns meeting list. ' +
      'Each meeting has an ID for fetching agenda items.',
  },
  {
    name:        'OpenGov',
    marketShare: '~8%',
    discoveryUrl: 'https://{entity}.opengov.com/meetings',
    apiEndpoint:  null,
    docFormat:    'pdf',
    notes:
      'Meeting pages at /meetings. No public API — ' +
      'scrape the meetings index page for PDF links.',
  },
  {
    name:        'Custom / Other',
    marketShare: '~7%',
    discoveryUrl: 'varies',
    apiEndpoint:  null,
    docFormat:    'both',
    notes:
      'Fallback: search for "minutes" OR "agenda" links on the ' +
      'main government website homepage. Use link text pattern matching.',
  },
];
