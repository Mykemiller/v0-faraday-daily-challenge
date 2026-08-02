-- Seed short descriptions for the 7 LIVE games. game_catalog.description was
-- empty for every live game (only the new_idea concepts carried one), so the
-- season-config Game slate had nothing to show. Copy is the canonical per-game
-- one-liner already shown to players on /help/tips ("format" line), lightly
-- expanded. Idempotent: only fills rows whose description is currently blank, so
-- re-running (or a later hand-edit via the Game Library) is never overwritten.

UPDATE public.game_catalog AS g SET description = v.d
FROM (VALUES
  ('The Brief',   'Read — study a short intelligence brief, then answer questions on it'),
  ('Signal Drop', 'Guess — Wordle-style guessing of a hidden infrastructure term'),
  ('Rackl',       'Connect — sort the tiles into four hidden groups'),
  ('Circuit',     'Sprint — true/false statements against the clock'),
  ('Dark Fiber',  'Match — pair each term with its definition'),
  ('Frequency',   'Quiz — multiple-choice questions'),
  ('The Stack',   'Rank — drag the items into the correct order')
) AS v(name, d)
WHERE g.display_name = v.name
  AND nullif(btrim(coalesce(g.description, '')), '') IS NULL;
