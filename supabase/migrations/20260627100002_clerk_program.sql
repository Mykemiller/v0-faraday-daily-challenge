-- County Clerk Partnership Program — outreach tracking and submission pipeline.
-- Coordinator dashboard tables for the July 2026 program launch (Vision §8).

CREATE TABLE IF NOT EXISTS clerk_program_contacts (
  id                  uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips5        text  NOT NULL,
  jurisdiction_id     uuid  REFERENCES jurisdictions(id) ON DELETE SET NULL,
  clerk_name          text,
  clerk_title         text,
  clerk_email         text,
  clerk_phone         text,
  outreach_status     text  NOT NULL DEFAULT 'not_contacted'
    CHECK (outreach_status IN (
      'not_contacted',
      'email_sent',
      'voicemail_left',
      'linkedin_dm',
      'association_ref',
      'responded',
      'accepted',
      'declined',
      'no_response',
      'escalated_planning'
    )),
  contact_date        date,
  followup_date       date,
  engagement_rate     text,
  notes               text,
  coordinator_notes   text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (county_fips5)
);

CREATE INDEX IF NOT EXISTS idx_clerk_status
  ON clerk_program_contacts(outreach_status, followup_date);
CREATE INDEX IF NOT EXISTS idx_clerk_fips
  ON clerk_program_contacts(county_fips5);

CREATE TABLE IF NOT EXISTS clerk_program_submissions (
  id                  uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          uuid     NOT NULL REFERENCES clerk_program_contacts(id) ON DELETE CASCADE,
  jurisdiction_id     uuid     NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
  county_fips5        text     NOT NULL,
  submission_date     date     NOT NULL DEFAULT CURRENT_DATE,
  engagement_hours    numeric(4,2)  DEFAULT 3.0,
  engagement_cost     numeric(8,2),

  dim_regulatory_raw  jsonb,
  dim_permitting_raw  jsonb,
  dim_power_raw       jsonb,
  dim_opposition_raw  jsonb,
  dim_incentives_raw  jsonb,

  dim_regulatory      numeric(3,2),
  dim_permitting      numeric(3,2),
  dim_power           numeric(3,2),
  dim_opposition      numeric(3,2),
  dim_incentives      numeric(3,2),

  township_contacts   jsonb,
  referral_count      integer   DEFAULT 0,

  review_status       text      DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'needs_review', 'rejected')),
  reviewed_by         text,
  reviewed_at         timestamptz,
  applied_to_jw       boolean   DEFAULT false,
  applied_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_clerk_submissions_status
  ON clerk_program_submissions(review_status, submission_date DESC);
CREATE INDEX IF NOT EXISTS idx_clerk_submissions_applied
  ON clerk_program_submissions(applied_to_jw, review_status);
CREATE INDEX IF NOT EXISTS idx_clerk_submissions_jurisdiction
  ON clerk_program_submissions(jurisdiction_id);
