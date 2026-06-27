-- Method C: event-triggered confidence upgrade.
-- Fires on every artifact INSERT; if the referenced jurisdiction is inferred/unscored,
-- each new artifact adds 8 confidence points (moving toward 'estimated' at 60+).
-- Assumes artifacts.jurisdiction_id FK exists (added in CC Prompts 1–3).

CREATE OR REPLACE FUNCTION trigger_confidence_upgrade_on_artifact()
RETURNS TRIGGER AS $$
DECLARE
  target_jurisdiction RECORD;
  new_confidence      numeric;
BEGIN
  IF NEW.jurisdiction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, confidence_score, confidence_tier
    INTO target_jurisdiction
    FROM jurisdictions
   WHERE id = NEW.jurisdiction_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Only upgrade inferred or unscored jurisdictions
  IF target_jurisdiction.confidence_tier NOT IN ('inferred','unscored') THEN
    RETURN NEW;
  END IF;

  -- Each artifact adds 8 points (no cap — will naturally cross tier boundaries)
  new_confidence := COALESCE(target_jurisdiction.confidence_score, 10) + 8;

  UPDATE jurisdictions SET
    confidence_score      = new_confidence,
    confidence_tier       = CASE
                              WHEN new_confidence >= 80 THEN 'verified'
                              WHEN new_confidence >= 60 THEN 'estimated'
                              WHEN new_confidence >= 40 THEN 'inferred'
                              ELSE 'unscored'
                            END,
    confidence_updated_at = NOW()
  WHERE id = NEW.jurisdiction_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'jw_confidence_upgrade_on_artifact'
  ) THEN
    CREATE TRIGGER jw_confidence_upgrade_on_artifact
      AFTER INSERT ON artifacts
      FOR EACH ROW EXECUTE FUNCTION trigger_confidence_upgrade_on_artifact();
  END IF;
END $$;
