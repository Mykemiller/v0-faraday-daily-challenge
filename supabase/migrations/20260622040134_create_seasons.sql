-- Leaderboard V2 §5.2: named multi-week Seasons + final results archive.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'season_status') THEN
    CREATE TYPE season_status AS ENUM ('upcoming','active','closed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug citext UNIQUE NOT NULL,
  name text NOT NULL,                          -- e.g. "Season 1 — Power Crunch"
  starts_on date NOT NULL,                      -- inclusive, Central
  ends_on   date NOT NULL,                      -- inclusive, Central
  status season_status NOT NULL DEFAULT 'upcoming',
  tz text NOT NULL DEFAULT 'America/Chicago',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

-- No two seasons may cover the same calendar day.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seasons_no_overlap') THEN
    ALTER TABLE public.seasons ADD CONSTRAINT seasons_no_overlap
      EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.season_results (
  season_id uuid REFERENCES public.seasons(id) ON DELETE CASCADE,
  subscriber_id uuid REFERENCES public.dc_subscribers(id) ON DELETE CASCADE,
  final_rank int NOT NULL,
  final_signals int NOT NULL,
  is_champion boolean NOT NULL DEFAULT false,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, subscriber_id)
);

-- Reads go through the service-role edge functions (which bypass RLS); locking
-- down anon/authenticated direct access keeps these consistent with dc_*.
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_results ENABLE ROW LEVEL SECURITY;

-- rollback:
--   DROP TABLE IF EXISTS public.season_results;
--   ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_no_overlap;
--   DROP TABLE IF EXISTS public.seasons;
--   DROP TYPE IF EXISTS season_status;
