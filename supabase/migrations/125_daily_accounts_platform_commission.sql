-- Daily accounts: commission typed per delivery platform. The existing
-- `commission` column becomes their total (worked out on save), and the
-- month sheet shows it with the card fee as "Commission & card fees".
-- Safe to run before or after the code.
BEGIN;

ALTER TABLE daily_accounts
  ADD COLUMN IF NOT EXISTS just_eat_commission NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deliveroo_commission NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS uber_eats_commission NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS hiest_commission NUMERIC(10,2);

COMMIT;
