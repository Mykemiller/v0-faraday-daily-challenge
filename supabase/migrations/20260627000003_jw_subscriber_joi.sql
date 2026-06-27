CREATE TABLE IF NOT EXISTS subscriber_joi_sets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id uuid NOT NULL,
  name          text NOT NULL CHECK (char_length(name) <= 100),
  description   text,
  color         text DEFAULT '#1C1C1C',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  CONSTRAINT max_sets_per_subscriber UNIQUE (subscriber_id, name)
);

CREATE INDEX IF NOT EXISTS idx_joi_sets_subscriber
  ON subscriber_joi_sets(subscriber_id);

CREATE TABLE IF NOT EXISTS subscriber_joi_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          uuid NOT NULL REFERENCES subscriber_joi_sets(id) ON DELETE CASCADE,
  jurisdiction_id uuid NOT NULL REFERENCES jurisdictions(id) ON DELETE CASCADE,
  added_at        timestamptz DEFAULT now(),
  UNIQUE(set_id, jurisdiction_id)
);

CREATE INDEX IF NOT EXISTS idx_joi_members_set
  ON subscriber_joi_members(set_id);
CREATE INDEX IF NOT EXISTS idx_joi_members_jurisdiction
  ON subscriber_joi_members(jurisdiction_id);

CREATE TABLE IF NOT EXISTS subscriber_joi_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          uuid NOT NULL REFERENCES subscriber_joi_sets(id) ON DELETE CASCADE,
  jurisdiction_id uuid NOT NULL REFERENCES jurisdictions(id),
  alert_type      text NOT NULL
    CHECK (alert_type IN (
      'tier_change','score_delta','new_opposition',
      'confidence_change','density_change'
    )),
  prior_value     text,
  new_value       text,
  delta           numeric(4,2),
  triggered_at    timestamptz DEFAULT now(),
  is_read         boolean     DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_joi_alerts_set
  ON subscriber_joi_alerts(set_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_joi_alerts_unread
  ON subscriber_joi_alerts(set_id) WHERE is_read = false;

ALTER TABLE subscriber_joi_sets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriber_joi_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriber_joi_alerts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscriber own sets" ON subscriber_joi_sets
  FOR ALL USING (subscriber_id = auth.uid());
CREATE POLICY "subscriber own members" ON subscriber_joi_members
  FOR ALL USING (
    set_id IN (SELECT id FROM subscriber_joi_sets WHERE subscriber_id = auth.uid())
  );
CREATE POLICY "subscriber own alerts" ON subscriber_joi_alerts
  FOR ALL USING (
    set_id IN (SELECT id FROM subscriber_joi_sets WHERE subscriber_id = auth.uid())
  );
