-- JW Data Acquisition Automations — Step 7 (FAR-JW-007)
-- JoI alert triggers: fire subscriber_joi_alerts rows on JPS tier change
-- (current_tier) and JDS tier change (jds_tier).
--
-- Both triggers reference subscriber_joi_members to find which JoI sets
-- include the jurisdiction that just changed, then insert one alert row
-- per affected set.
--
-- alert_type:
--   'tier_change'    — JPS current_tier changed (e.g. Mixed → Cautious)
--   'density_change' — JDS jds_tier changed (e.g. Active → Dense)

-- ── JPS tier-change alert ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_joi_alert_on_tier_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.current_tier IS DISTINCT FROM NEW.current_tier THEN
    INSERT INTO subscriber_joi_alerts
      (set_id, jurisdiction_id, alert_type, prior_value, new_value, delta)
    SELECT
      m.set_id,
      NEW.id,
      'tier_change',
      OLD.current_tier,
      NEW.current_tier,
      NEW.current_score - COALESCE(OLD.current_score, NEW.current_score)
    FROM subscriber_joi_members m
    WHERE m.jurisdiction_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jw_tier_change_alert ON jurisdictions;

CREATE TRIGGER jw_tier_change_alert
  AFTER UPDATE OF current_tier ON jurisdictions
  FOR EACH ROW EXECUTE FUNCTION trigger_joi_alert_on_tier_change();

-- ── JDS density-change alert ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_joi_alert_on_density_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.jds_tier IS DISTINCT FROM NEW.jds_tier THEN
    INSERT INTO subscriber_joi_alerts
      (set_id, jurisdiction_id, alert_type, prior_value, new_value, delta)
    SELECT
      m.set_id,
      NEW.id,
      'density_change',
      OLD.jds_tier,
      NEW.jds_tier,
      NEW.jds_normalized - COALESCE(OLD.jds_normalized, NEW.jds_normalized)
    FROM subscriber_joi_members m
    WHERE m.jurisdiction_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jw_density_change_alert ON jurisdictions;

CREATE TRIGGER jw_density_change_alert
  AFTER UPDATE OF jds_tier ON jurisdictions
  FOR EACH ROW EXECUTE FUNCTION trigger_joi_alert_on_density_change();
