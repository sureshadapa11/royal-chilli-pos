-- 085 — Remove legacy global unique rules for multi-business independence.
--
-- Run after 076–084 before opening a second business.
--
-- Background:
-- • Migration 078 added timesheets_business_unique while intentionally retaining
--   the older per-staff/pay-period rule.
-- • Migration 079 added business-scoped uniqueness for customer phone,
--   customer account email (case-insensitive with password), newsletter subscriber
--   email, and loyalty tier names, but left legacy global rules in place.
-- • Migration 084 finalized multi-business foundation and integrity guards,
--   leaving legacy global rules to be removed in this dedicated migration.
--
-- This migration removes ONLY the obsolete global uniqueness rules that block
-- multi-business operations, ensuring the business-scoped replacements are in
-- place.
--
-- Rules removed:
-- 1. customers (phone) global uniqueness (customers_phone_key)
--    -> replaced by customers_business_phone_unique (business_id, phone)
-- 2. customers account email global uniqueness (customers_email_account_unique)
--    -> replaced by customers_business_email_account_unique (business_id, lower(email)) WHERE password_hash IS NOT NULL
-- 3. newsletter_subscribers (email) global uniqueness (newsletter_subscribers_email_key)
--    -> replaced by newsletter_business_email_unique (business_id, email)
-- 4. loyalty_tiers (name) global uniqueness (loyalty_tiers_name_key)
--    -> replaced by loyalty_tiers_business_name_unique (business_id, name)
-- 5. timesheets (staff_id, period_start, period_end) global uniqueness (timesheets_staff_id_period_start_period_end_key)
--    -> replaced by timesheets_business_unique (business_id, staff_id, period_start, period_end)
--
-- Rules strictly preserved (never dropped or weakened):
-- • staff.username (staff_username_key) - global login uniqueness across group
-- • staff.employee_number (staff_employee_number_key) - global employee number
-- • customers.referral_code (customers_referral_code_key) - global referral codes
-- • loyalty_redemptions.code (loyalty_redemptions_code_key) - global voucher codes
-- • orders (orders_business_unique: business_id, order_number)
-- • purchase_orders (purchase_orders_business_unique: business_id, order_number)
-- • payroll_periods (payroll_periods_business_unique: business_id, period_start, period_end)
-- • fs_signoff (fs_signoff_business_unique: business_id, day)
--
-- Safety:
-- • Safe to re-run (idempotent) and fully transactional (BEGIN / COMMIT).
-- • Catches duplicate rows within a business by failing clearly; does not
--   silently delete, merge, or rewrite data.

BEGIN;

-- ── 1. Validate prerequisites ──────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'newsletter_subscribers', 'loyalty_tiers', 'timesheets'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION 'Migration 085 requires table % to exist', t;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'customers'::regclass AND attname = 'business_id' AND attnum > 0 AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'newsletter_subscribers'::regclass AND attname = 'business_id' AND attnum > 0 AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'loyalty_tiers'::regclass AND attname = 'business_id' AND attnum > 0 AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'timesheets'::regclass AND attname = 'business_id' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Migration 085 requires business_id on customers, newsletter_subscribers, loyalty_tiers, and timesheets (from migrations 078/079/084)';
  END IF;
END $$;

-- ── 2. Ensure business-scoped unique rules exist ─────────────────────────────
-- (If duplicate rows already exist within a business, constraint creation will
-- fail clearly and safely without silently mutating or dropping records.)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'customers'::regclass
      AND conname = 'customers_business_phone_unique'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT customers_business_phone_unique UNIQUE (business_id, phone);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'newsletter_subscribers'::regclass
      AND conname = 'newsletter_business_email_unique'
  ) THEN
    ALTER TABLE newsletter_subscribers ADD CONSTRAINT newsletter_business_email_unique UNIQUE (business_id, email);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'loyalty_tiers'::regclass
      AND conname = 'loyalty_tiers_business_name_unique'
  ) THEN
    ALTER TABLE loyalty_tiers ADD CONSTRAINT loyalty_tiers_business_name_unique UNIQUE (business_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'timesheets'::regclass
      AND conname = 'timesheets_business_unique'
  ) THEN
    ALTER TABLE timesheets ADD CONSTRAINT timesheets_business_unique UNIQUE (business_id, staff_id, period_start, period_end);
  END IF;
END $$;

-- Customer account email (case-insensitive, scoped to business, only for rows with a password hash)
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_email_account_unique
  ON customers (business_id, lower(email))
  WHERE password_hash IS NOT NULL;

-- ── 3. Drop obsolete global unique constraints ───────────────────────────────
-- Drop by explicit default name if present, and dynamically drop any matching
-- unique constraint on the legacy global column sets via pg_constraint catalog.

DO $$
DECLARE
  r record;
  c record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('customers',              ARRAY['phone']),
    ('newsletter_subscribers', ARRAY['email']),
    ('loyalty_tiers',          ARRAY['name']),
    ('timesheets',             ARRAY['period_end', 'period_start', 'staff_id'])
  ) v(tbl, cols)
  LOOP
    FOR c IN
      SELECT con.conname
      FROM pg_constraint con
      WHERE con.conrelid = r.tbl::regclass
        AND con.contype = 'u'
        AND (
          SELECT array_agg(a.attname::text ORDER BY a.attname::text)
          FROM pg_attribute a
          WHERE a.attrelid = con.conrelid
            AND a.attnum = ANY (con.conkey)
        ) = r.cols
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, c.conname);
    END LOOP;
  END LOOP;
END $$;

-- Fallback IF EXISTS drops for standard constraint names
ALTER TABLE customers              DROP CONSTRAINT IF EXISTS customers_phone_key;
ALTER TABLE newsletter_subscribers DROP CONSTRAINT IF EXISTS newsletter_subscribers_email_key;
ALTER TABLE loyalty_tiers          DROP CONSTRAINT IF EXISTS loyalty_tiers_name_key;
ALTER TABLE timesheets             DROP CONSTRAINT IF EXISTS timesheets_staff_id_period_start_period_end_key;

-- ── 4. Drop obsolete global unique indexes ───────────────────────────────────
-- Drop legacy global partial account email unique index
DROP INDEX IF EXISTS customers_email_account_unique;

-- Dynamically drop any remaining global unique index on customers lower(email) without business_id
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT i.relname AS index_name
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    WHERE t.oid = 'customers'::regclass
      AND x.indisunique
      AND i.relname <> 'customers_business_email_account_unique'
      AND pg_get_expr(x.indpred, x.indrelid) ILIKE '%password_hash%IS NOT NULL%'
      AND pg_get_indexdef(x.indexrelid) ILIKE '%lower(email)%'
      AND pg_get_indexdef(x.indexrelid) NOT ILIKE '%business_id%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx.index_name);
  END LOOP;
END $$;

-- Drop any remaining standalone global unique indexes on the obsolete column sets
DO $$
DECLARE
  r record;
  idx record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('customers',              ARRAY['phone']),
    ('newsletter_subscribers', ARRAY['email']),
    ('loyalty_tiers',          ARRAY['name']),
    ('timesheets',             ARRAY['period_end', 'period_start', 'staff_id'])
  ) v(tbl, cols)
  LOOP
    FOR idx IN
      SELECT i.relname AS index_name
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      WHERE t.oid = r.tbl::regclass
        AND x.indisunique
        AND NOT x.indisprimary
        AND x.indpred IS NULL
        AND (
          SELECT array_agg(a.attname::text ORDER BY a.attname::text)
          FROM pg_attribute a
          WHERE a.attrelid = t.oid
            AND a.attnum = ANY (x.indkey::smallint[])
        ) = r.cols
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
        )
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS %I', idx.index_name);
    END LOOP;
  END LOOP;
END $$;

-- Fallback IF EXISTS drops for standard index names (if not already dropped by constraint removal)
DROP INDEX IF EXISTS customers_phone_key;
DROP INDEX IF EXISTS newsletter_subscribers_email_key;
DROP INDEX IF EXISTS loyalty_tiers_name_key;
DROP INDEX IF EXISTS timesheets_staff_id_period_start_period_end_key;

COMMIT;

-- ── Verification queries (run in Supabase SQL Editor after applying) ─────────
--
-- 1. Ensure obsolete global constraints are gone:
--    SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'customers_phone_key',
--      'newsletter_subscribers_email_key',
--      'loyalty_tiers_name_key',
--      'timesheets_staff_id_period_start_period_end_key'
--    );
--    --> Expected result: 0 rows returned.
--
-- 2. Ensure obsolete global account email index is gone:
--    SELECT indexname, tablename, indexdef
--    FROM pg_indexes
--    WHERE indexname = 'customers_email_account_unique';
--    --> Expected result: 0 rows returned.
--
-- 3. Ensure business-scoped rules are active:
--    SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'customers_business_phone_unique',
--      'newsletter_business_email_unique',
--      'loyalty_tiers_business_name_unique',
--      'timesheets_business_unique'
--    )
--    ORDER BY conname;
--    --> Expected result: 4 rows returned.
--
--    SELECT indexname, tablename, indexdef
--    FROM pg_indexes
--    WHERE indexname = 'customers_business_email_account_unique';
--    --> Expected result: 1 row returned.
--
-- 4. Ensure intentional global uniqueness rules remain preserved:
--    SELECT conname, conrelid::regclass AS table_name, pg_get_constraintdef(oid)
--    FROM pg_constraint
--    WHERE conname IN (
--      'staff_username_key',
--      'staff_employee_number_key',
--      'customers_referral_code_key',
--      'loyalty_redemptions_code_key'
--    )
--    ORDER BY conname;
--    --> Expected result: 4 rows returned.
