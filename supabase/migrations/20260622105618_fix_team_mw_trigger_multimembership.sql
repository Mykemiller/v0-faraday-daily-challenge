-- Multi-membership (§7.2) means a member can be in several groups, so the legacy
-- lifetime-MW trigger can no longer assume one team per email. Update every
-- membership + every team the member belongs to. (V2 standings rank from
-- dc_completions, not this lifetime mw_total — but keep it consistent.)
CREATE OR REPLACE FUNCTION public.dc_completion_to_team_mw()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email public.dc_subscribers.email%type;
BEGIN
  IF coalesce(new.mw_earned, 0) = 0 THEN
    RETURN new;
  END IF;

  SELECT email INTO v_email FROM public.dc_subscribers WHERE id = new.subscriber_id;
  IF v_email IS NULL THEN
    RETURN new;
  END IF;

  -- Bump the member's personal contribution across ALL their groups.
  UPDATE public.team_members
     SET my_mw = coalesce(my_mw, 0) + new.mw_earned
   WHERE member_email = v_email;

  -- Bump the lifetime total of every group the member belongs to.
  UPDATE public.teams t
     SET mw_total = coalesce(mw_total, 0) + new.mw_earned
   WHERE EXISTS (SELECT 1 FROM public.team_members m WHERE m.team_id = t.id AND m.member_email = v_email);

  RETURN new;
END;
$function$;

-- rollback: restore the single-row RETURNING INTO form from teams_dc003_mw_wiring.
