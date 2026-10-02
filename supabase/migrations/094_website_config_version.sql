-- Optimistic locking for Staff Hub → Operations → Website. Every save to
-- businesses.website_config / modules.online_ordering through
-- /api/website/config bumps this number, and only writes if it still matches
-- the version the save was based on. A save made from stale data gets 409
-- instead of silently overwriting someone else's change.

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS website_config_version INT NOT NULL DEFAULT 1;

COMMIT;
