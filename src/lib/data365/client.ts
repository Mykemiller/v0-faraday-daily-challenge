// Data365 API client — Facebook public group data.
// Sign up: https://data365.co (commercial API, ~$200–800/mo depending on volume)
// Docs: https://api.data365.co/v1.1/docs

const DATA365_BASE = 'https://api.data365.co/v1.1';

function apiKey(): string {
  const key = process.env.DATA365_API_KEY;
  if (!key) throw new Error('DATA365_API_KEY is not set');
  return key;
}

export interface Data365GroupPost {
  id:             string;
  group_id:       string;
  text:           string;
  created_time:   string;
  likes_count:    number;
  comments_count: number;
  shares_count:   number;
  url:            string;
}

export interface Data365Group {
  id:          string;
  name:        string;
  members:     number;
  description: string;
  privacy:     'OPEN' | 'CLOSED';
}

// Fetch posts from a public Facebook group.
// Rate limit: ~60 req/min on standard plan — callers must pace.
export async function fetchGroupPosts(
  groupId: string,
  maxPosts = 50,
): Promise<Data365GroupPost[]> {
  const url =
    `${DATA365_BASE}/facebook/group/${encodeURIComponent(groupId)}/posts` +
    `?access_token=${apiKey()}&max_posts=${maxPosts}&include_comments=false`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Data365 fetchGroupPosts ${res.status}: ${groupId}`);
  const data = await res.json();
  return (data?.items ?? []) as Data365GroupPost[];
}

// Search for public Facebook groups by keyword + location.
// Only OPEN groups are accessible; CLOSED groups are filtered out.
export async function searchGroups(
  keyword: string,
  locationHint = '',
): Promise<Data365Group[]> {
  const query = encodeURIComponent(`${keyword} ${locationHint}`.trim());
  const url =
    `${DATA365_BASE}/facebook/search/groups` +
    `?access_token=${apiKey()}&query=${query}&limit=20`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return ((data?.items ?? []) as Data365Group[]).filter(g => g.privacy === 'OPEN');
}
