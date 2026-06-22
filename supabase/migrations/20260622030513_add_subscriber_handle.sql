-- Leaderboard V2 §5.1 + §6: claimed identity handles.
-- Adds a chosen handle to subscribers (nullable until claimed) and a slot on
-- the magic-link row so the handle survives the email round-trip and is bound
-- server-side in verify-magic-link (review #5). citext type already in use
-- (teams.code), so no CREATE EXTENSION needed.
-- Applied to prod (ycadmmngkdhvpcsrcuaq) as version 20260622030513.

ALTER TABLE public.dc_subscribers ADD COLUMN IF NOT EXISTS handle citext;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dc_subscribers_handle_key'
  ) THEN
    ALTER TABLE public.dc_subscribers ADD CONSTRAINT dc_subscribers_handle_key UNIQUE (handle);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dc_subscribers_handle_format'
  ) THEN
    ALTER TABLE public.dc_subscribers
      ADD CONSTRAINT dc_subscribers_handle_format
      CHECK (handle IS NULL OR handle ~ '^[a-z0-9_]{3,20}$');
  END IF;
END $$;

-- Chosen handle, captured at register time, bound to the subscriber on verify.
ALTER TABLE public.dc_magic_links ADD COLUMN IF NOT EXISTS handle citext;

-- rollback:
--   ALTER TABLE public.dc_magic_links DROP COLUMN IF EXISTS handle;
--   ALTER TABLE public.dc_subscribers DROP CONSTRAINT IF EXISTS dc_subscribers_handle_format;
--   ALTER TABLE public.dc_subscribers DROP CONSTRAINT IF EXISTS dc_subscribers_handle_key;
--   ALTER TABLE public.dc_subscribers DROP COLUMN IF EXISTS handle;
