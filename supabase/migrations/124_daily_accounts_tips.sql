-- Daily accounts: card and cash tips from the Z report, on their own line.
-- Tips belong to staff, so the Z report column (net sales) no longer includes
-- them. Safe to run before or after the code.
BEGIN;

ALTER TABLE daily_accounts ADD COLUMN IF NOT EXISTS tips NUMERIC(10,2);

COMMIT;
