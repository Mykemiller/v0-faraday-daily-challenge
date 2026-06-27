// County Clerk Partnership Program — internal coordinator dashboard.
// Route: /internal/clerk-program
// Auth: requires PIPELINE_SECRET as a query param (?key=...) or
//       SUPABASE_SERVICE_ROLE_KEY present on the server (Vercel internal only).
//
// Shows outreach funnel, submission queue, and program KPIs.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Clerk Program — Faraday Internal',
  robots: 'noindex',
};

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'https://ycadmmngkdhvpcsrcuaq.supabase.co';

type Svc = { base: string; headers: Record<string, string> };

function svc(): Svc | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return {
    base:    `${SUPABASE_URL}/rest/v1`,
    headers: {
      apikey:         key,
      Authorization:  `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

interface StatusCount { outreach_status: string; count: string }
interface SubmissionSummary { review_status: string; applied_to_jw: boolean; count: string }
interface RecentSubmission {
  id:              string;
  county_fips5:    string;
  submission_date: string;
  review_status:   string;
  applied_to_jw:   boolean;
  engagement_hours: number | null;
}

const FUNNEL_STEPS = [
  { status: 'not_contacted',       label: 'Not contacted' },
  { status: 'email_sent',          label: 'Email sent' },
  { status: 'voicemail_left',      label: 'Voicemail left' },
  { status: 'responded',           label: 'Responded' },
  { status: 'accepted',            label: 'Accepted' },
  { status: 'declined',            label: 'Declined' },
  { status: 'no_response',         label: 'No response' },
  { status: 'escalated_planning',  label: 'Escalated' },
];

const STATUS_COLOR: Record<string, string> = {
  pending:      'bg-amber-100 text-amber-800',
  approved:     'bg-green-100 text-green-800',
  needs_review: 'bg-blue-100  text-blue-800',
  rejected:     'bg-red-100   text-red-800',
};

export default async function ClerkProgramDashboard() {
  const s = svc();
  if (!s) {
    return (
      <div className="p-8 text-red-700 text-sm">
        SUPABASE_SERVICE_ROLE_KEY not set. This dashboard requires server-side access.
      </div>
    );
  }

  const [contactsR, submissionsR, recentR] = await Promise.allSettled([
    fetch(
      `${s.base}/clerk_program_contacts?select=outreach_status`,
      { headers: s.headers, cache: 'no-store' }
    ).then(r => r.ok ? r.json() as Promise<{ outreach_status: string }[]> : []),

    fetch(
      `${s.base}/clerk_program_submissions?select=review_status,applied_to_jw`,
      { headers: s.headers, cache: 'no-store' }
    ).then(r => r.ok ? r.json() as Promise<{ review_status: string; applied_to_jw: boolean }[]> : []),

    fetch(
      `${s.base}/clerk_program_submissions` +
      `?select=id,county_fips5,submission_date,review_status,applied_to_jw,engagement_hours` +
      `&order=submission_date.desc&limit=20`,
      { headers: s.headers, cache: 'no-store' }
    ).then(r => r.ok ? r.json() as Promise<RecentSubmission[]> : []),
  ]);

  const allContacts   = contactsR.status   === 'fulfilled' ? contactsR.value    : [];
  const allSubs       = submissionsR.status === 'fulfilled' ? submissionsR.value : [];
  const recentSubs    = recentR.status      === 'fulfilled' ? recentR.value      : [];

  // Build funnel counts
  const statusCounts: Record<string, number> = {};
  for (const c of allContacts) {
    statusCounts[c.outreach_status] = (statusCounts[c.outreach_status] ?? 0) + 1;
  }

  const totalContacted   = allContacts.length;
  const totalAccepted    = statusCounts.accepted    ?? 0;
  const totalSubmissions = allSubs.length;
  const pendingReview    = allSubs.filter(s => s.review_status === 'pending').length;
  const appliedToJw      = allSubs.filter(s => s.applied_to_jw).length;

  const conversionPct = totalContacted > 0
    ? Math.round((totalAccepted / totalContacted) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-stone-50 p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-mono uppercase tracking-widest text-stone-400 mb-1">
            Faraday Intelligence · Internal
          </p>
          <h1 className="text-2xl font-bold text-stone-800">
            County Clerk Partnership Program
          </h1>
          <p className="text-stone-500 text-sm mt-1">
            Coordinator dashboard — July 2026 launch · 3,143 US counties target
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total outreach',   value: totalContacted,   sub: 'of 3,143 counties' },
            { label: 'Accepted',         value: totalAccepted,    sub: `${conversionPct}% conversion` },
            { label: 'Submissions',      value: totalSubmissions, sub: `${pendingReview} pending review` },
            { label: 'Applied to JW',    value: appliedToJw,      sub: 'dimension scores written' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white border border-stone-200 rounded-lg p-4">
              <p className="text-xs text-stone-400 uppercase tracking-widest mb-1">{kpi.label}</p>
              <p className="text-3xl font-bold text-stone-800">{kpi.value.toLocaleString()}</p>
              <p className="text-xs text-stone-400 mt-1">{kpi.sub}</p>
            </div>
          ))}
        </div>

        {/* Outreach funnel */}
        <div className="bg-white border border-stone-200 rounded-lg p-5 mb-6">
          <h2 className="font-semibold text-stone-700 mb-4">Outreach funnel</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {FUNNEL_STEPS.map(step => (
              <div key={step.status} className="text-center">
                <p className="text-2xl font-bold text-stone-800">
                  {(statusCounts[step.status] ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-stone-400 mt-0.5">{step.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Submission queue */}
        <div className="bg-white border border-stone-200 rounded-lg p-5">
          <h2 className="font-semibold text-stone-700 mb-4">
            Recent submissions
            {pendingReview > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full">
                {pendingReview} pending
              </span>
            )}
          </h2>

          {recentSubs.length === 0 ? (
            <p className="text-stone-400 text-sm">No submissions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-400 uppercase tracking-widest border-b border-stone-100">
                    <th className="pb-2 pr-4">County FIPS</th>
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Hours</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Applied to JW</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSubs.map(sub => (
                    <tr key={sub.id} className="border-b border-stone-50 hover:bg-stone-50">
                      <td className="py-2 pr-4 font-mono text-xs text-stone-600">{sub.county_fips5}</td>
                      <td className="py-2 pr-4 text-stone-600">{sub.submission_date}</td>
                      <td className="py-2 pr-4 text-stone-600">{sub.engagement_hours ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLOR[sub.review_status] ?? 'bg-stone-100 text-stone-600'}`}>
                          {sub.review_status}
                        </span>
                      </td>
                      <td className="py-2 text-stone-600">
                        {sub.applied_to_jw ? '✓' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Apply button — triggers the apply API */}
          {pendingReview === 0 && appliedToJw < totalSubmissions && (
            <div className="mt-4 pt-4 border-t border-stone-100">
              <p className="text-xs text-stone-400">
                To apply approved submissions to JW scores, POST to{' '}
                <code className="font-mono bg-stone-100 px-1 rounded">/api/clerk-program/apply</code>{' '}
                with <code className="font-mono bg-stone-100 px-1 rounded">Authorization: Bearer PIPELINE_SECRET</code>.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-stone-300 mt-6 text-center">
          Internal only · not indexed · {new Date().toISOString()}
        </p>
      </div>
    </div>
  );
}
