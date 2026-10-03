-- 096: business code for the shared staff sign-in (crewportal.vercel.app/staff).
-- Managers and the owner type their business's code, then see that business's
-- branded sign-in. Codes aren't secret (the password is) but must be unique.
-- Safe to re-run.
BEGIN;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS login_code TEXT;

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_login_code_format;
ALTER TABLE businesses ADD CONSTRAINT businesses_login_code_format
  CHECK (login_code IS NULL OR login_code ~ '^[A-Z0-9]{2,8}$');

CREATE UNIQUE INDEX IF NOT EXISTS businesses_login_code_unique
  ON businesses (login_code) WHERE login_code IS NOT NULL;

UPDATE businesses SET login_code = 'RC' WHERE slug = 'royal-chilli' AND login_code IS NULL;
UPDATE businesses SET login_code = 'MH' WHERE slug = 'melt-house'   AND login_code IS NULL;

COMMIT;
