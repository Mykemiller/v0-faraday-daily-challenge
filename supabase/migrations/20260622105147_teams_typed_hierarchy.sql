-- Leaderboard V2 §7.1: typed Company -> Team hierarchy on the existing teams table.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'group_type') THEN
    CREATE TYPE group_type AS ENUM ('company','team','custom');
  END IF;
END $$;

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS group_type group_type NOT NULL DEFAULT 'custom';
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS teams_parent_idx ON public.teams (parent_id);

CREATE OR REPLACE FUNCTION public.enforce_group_hierarchy() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE parent_type group_type;
BEGIN
  IF NEW.group_type IN ('company','custom') AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'group_type % must not have a parent', NEW.group_type;
  END IF;
  IF NEW.group_type = 'team' AND NEW.parent_id IS NOT NULL THEN
    SELECT group_type INTO parent_type FROM public.teams WHERE id = NEW.parent_id;
    IF parent_type IS DISTINCT FROM 'company' THEN
      RAISE EXCEPTION 'a team''s parent must be a company';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_group_hierarchy ON public.teams;
CREATE TRIGGER trg_enforce_group_hierarchy BEFORE INSERT OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_hierarchy();

-- rollback:
--   DROP TRIGGER IF EXISTS trg_enforce_group_hierarchy ON public.teams;
--   DROP FUNCTION IF EXISTS public.enforce_group_hierarchy();
--   DROP INDEX IF EXISTS public.teams_parent_idx;
--   ALTER TABLE public.teams DROP COLUMN IF EXISTS parent_id;
--   ALTER TABLE public.teams DROP COLUMN IF EXISTS group_type;
--   DROP TYPE IF EXISTS group_type;
