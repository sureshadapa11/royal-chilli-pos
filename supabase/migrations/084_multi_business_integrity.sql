-- 084 — Complete tenant scoping and relationship checks.
--
-- Run after 076–083. Child rows inherit business_id from their owning row;
-- optional references are checked only when present. Existing data is kept
-- and backfilled from its owner before the triggers are installed.

BEGIN;

-- These child tables are queried through bizDb or belong to a tenant-owned
-- order/customer. Keep them directly scopeable as well as connected by FK.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_paid_outs', 'customer_addresses', 'loyalty_tier_changes',
    'menu_item_modifier_groups', 'modifier_options',
    'order_items', 'order_item_modifiers',
    'payroll_entries', 'payroll_payments',
    'purchase_order_items', 'recipe_ingredients', 'stock_take_lines'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS business_id INT NOT NULL DEFAULT 1 REFERENCES businesses(id)',
      t
    );
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (business_id)', 'idx_' || t || '_business', t);
  END LOOP;
END $$;

-- A child may already exist under a business other than 1. The primary parent
-- is authoritative; secondary links are validated below before commit.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cash_paid_outs',          'work_periods',            'work_period_id'),
    ('customer_addresses',      'customers',               'customer_id'),
    ('loyalty_tier_changes',    'customers',               'customer_id'),
    ('menu_item_modifier_groups','menu_items',              'menu_item_id'),
    ('modifier_options',        'modifier_groups',         'group_id'),
    ('order_items',             'orders',                  'order_id'),
    ('order_item_modifiers',    'order_items',             'order_item_id'),
    ('payroll_entries',         'payroll_periods',         'payroll_period_id'),
    ('payroll_payments',        'payroll_entries',         'payroll_entry_id'),
    ('purchase_order_items',    'purchase_orders',         'purchase_order_id'),
    ('recipe_ingredients',      'recipes',                 'recipe_id'),
    ('stock_take_lines',        'stock_takes',             'stock_take_id')
  ) v(child_table, parent_table, parent_column)
  LOOP
    EXECUTE format(
      'UPDATE %I child SET business_id = parent.business_id
       FROM %I parent
       WHERE child.%I = parent.id
         AND child.business_id IS DISTINCT FROM parent.business_id',
      r.child_table, r.parent_table, r.parent_column
    );
  END LOOP;
END $$;

-- Future child rows inherit their business from the owning row. Trigger
-- signatures match the existing 076 helper: (parent table, FK column) pairs.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cash_paid_outs',           ARRAY['work_periods', 'work_period_id']),
    ('customer_addresses',       ARRAY['customers', 'customer_id']),
    ('loyalty_tier_changes',     ARRAY['customers', 'customer_id']),
    ('menu_item_modifier_groups',ARRAY['menu_items', 'menu_item_id']),
    ('modifier_options',         ARRAY['modifier_groups', 'group_id']),
    ('order_items',              ARRAY['orders', 'order_id']),
    ('order_item_modifiers',     ARRAY['order_items', 'order_item_id']),
    ('payroll_entries',          ARRAY['payroll_periods', 'payroll_period_id']),
    ('payroll_payments',         ARRAY['payroll_entries', 'payroll_entry_id']),
    ('purchase_order_items',     ARRAY['purchase_orders', 'purchase_order_id']),
    ('recipe_ingredients',       ARRAY['recipes', 'recipe_id']),
    ('stock_take_lines',         ARRAY['stock_takes', 'stock_take_id'])
  ) v(tbl, args)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_inherit_business ON %I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_inherit_business BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION inherit_business_id(%s)',
      r.tbl, (SELECT string_agg(quote_literal(a), ', ') FROM unnest(r.args) a)
    );
  END LOOP;
END $$;

-- Migration 076 listed a non-existent print_jobs.work_period_id field. Print
-- jobs only reference orders, which already supplies their business.
DROP TRIGGER IF EXISTS trg_inherit_business ON print_jobs;
CREATE TRIGGER trg_inherit_business BEFORE INSERT OR UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION inherit_business_id('orders', 'order_id');

-- The owning parent determines the business. Other parent links must agree.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cash_paid_outs',       ARRAY['staff', 'staff_id']),
    ('loyalty_tier_changes', ARRAY['loyalty_tiers', 'from_tier_id', 'loyalty_tiers', 'to_tier_id']),
    ('menu_item_modifier_groups', ARRAY['modifier_groups', 'group_id']),
    ('order_items',          ARRAY['menu_items', 'menu_item_id']),
    ('order_item_modifiers', ARRAY['modifier_options', 'modifier_option_id']),
    ('payroll_entries',      ARRAY['staff', 'staff_id']),
    ('payroll_payments',     ARRAY['staff', 'recorded_by']),
    ('purchase_order_items', ARRAY['ingredients', 'ingredient_id']),
    ('recipe_ingredients',   ARRAY['ingredients', 'ingredient_id']),
    ('stock_take_lines',     ARRAY['ingredients', 'ingredient_id'])
  ) v(tbl, args)
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_match_business ON %I',
      r.tbl
    );
    EXECUTE format(
      'CREATE TRIGGER trg_match_business BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION check_business_match(%s)',
      r.tbl, (SELECT string_agg(quote_literal(a), ', ') FROM unnest(r.args) a)
    );
  END LOOP;
END $$;

-- Extend 076/079 checks to every tenant-owned parent/staff reference, including
-- fields added after those migrations. NULL references and the unassigned
-- group owner (staff.business_id IS NULL) remain valid.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('work_periods', ARRAY['staff', 'opened_by', 'staff', 'closed_by']),
    ('orders', ARRAY[
      'restaurant_tables', 'table_id', 'work_periods', 'work_period_id',
      'customers', 'customer_id', 'delivery_zones', 'delivery_zone_id',
      'staff', 'staff_id', 'staff', 'driver_id',
      'staff', 'discount_given_by_staff_id', 'staff', 'loyalty_given_by_staff_id'
    ]),
    ('payments', ARRAY['staff', 'staff_id']),
    ('expenses', ARRAY['staff', 'recorded_by']),
    ('purchase_orders', ARRAY['suppliers', 'supplier_id', 'staff', 'created_by']),
    ('supplier_payments', ARRAY['suppliers', 'supplier_id', 'purchase_orders', 'purchase_order_id', 'staff', 'recorded_by']),
    ('reservations', ARRAY['restaurant_tables', 'table_id', 'customers', 'customer_id']),
    ('attendance_corrections', ARRAY['attendance', 'attendance_id', 'staff', 'staff_id', 'staff', 'reviewed_by']),
    ('loyalty_transactions', ARRAY['customers', 'customer_id', 'staff', 'staff_id']),
    ('loyalty_redemptions', ARRAY[
      'customers', 'customer_id', 'loyalty_rewards', 'reward_id',
      'orders', 'redeemed_order_id', 'staff', 'issued_by_staff_id',
      'staff', 'redeemed_by_staff_id'
    ]),
    ('shifts', ARRAY['staff', 'staff_id', 'staff', 'created_by']),
    ('attendance', ARRAY['staff', 'staff_id', 'shifts', 'shift_id', 'staff', 'approved_by', 'staff', 'entered_by']),
    ('timesheets', ARRAY['staff', 'staff_id', 'staff', 'approved_by']),
    ('leave_requests', ARRAY['staff', 'staff_id', 'staff', 'decided_by']),
    ('employee_payslips', ARRAY['staff', 'staff_id', 'staff', 'created_by']),
    ('stock_movements', ARRAY['ingredients', 'ingredient_id', 'staff', 'staff_id']),
    ('stock_takes', ARRAY['staff', 'counted_by', 'staff', 'posted_by']),
    ('ingredients', ARRAY['suppliers', 'supplier_id']),
    ('fs_check_log', ARRAY['fs_check_type', 'check_type_id', 'staff', 'staff_id']),
    ('fs_temp_log', ARRAY['fs_temp_type', 'temp_type_id', 'staff', 'staff_id']),
    ('fs_delivery_check', ARRAY['purchase_orders', 'purchase_order_id', 'suppliers', 'supplier_id', 'staff', 'staff_id']),
    ('fs_problem', ARRAY['staff', 'staff_id']),
    ('fs_signoff', ARRAY['staff', 'staff_id']),
    ('staff_messages', ARRAY['staff', 'created_by']),
    ('audit_logs', ARRAY['staff', 'staff_id']),
    ('platform_sales', ARRAY['staff', 'entered_by'])
  ) v(tbl, args)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_match_business ON %I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_match_business BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION check_business_match(%s)',
      r.tbl, (SELECT string_agg(quote_literal(a), ', ') FROM unnest(r.args) a)
    );
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_inherit_business ON loyalty_transactions;
CREATE TRIGGER trg_inherit_business BEFORE INSERT OR UPDATE ON loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION loyalty_business_from_order();

-- Refuse to commit any pre-existing cross-business links rather than silently
-- reassigning a child to match one of its conflicting secondary parents.
DO $$
DECLARE
  r record;
  i integer;
  mismatch boolean;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cash_paid_outs',       ARRAY['staff', 'staff_id']),
    ('loyalty_tier_changes', ARRAY['loyalty_tiers', 'from_tier_id', 'loyalty_tiers', 'to_tier_id']),
    ('menu_item_modifier_groups', ARRAY['modifier_groups', 'group_id']),
    ('order_items',          ARRAY['menu_items', 'menu_item_id']),
    ('order_item_modifiers', ARRAY['modifier_options', 'modifier_option_id']),
    ('payroll_entries',      ARRAY['staff', 'staff_id']),
    ('payroll_payments',     ARRAY['staff', 'recorded_by']),
    ('purchase_order_items', ARRAY['ingredients', 'ingredient_id']),
    ('recipe_ingredients',   ARRAY['ingredients', 'ingredient_id']),
    ('stock_take_lines',     ARRAY['ingredients', 'ingredient_id'])
  ) v(tbl, args)
  LOOP
    FOR i IN 1..array_length(r.args, 1) BY 2 LOOP
      EXECUTE format(
        'SELECT EXISTS (
           SELECT 1 FROM %I child JOIN %I parent ON child.%I = parent.id
           WHERE child.business_id IS DISTINCT FROM parent.business_id
             AND parent.business_id IS NOT NULL
         )',
        r.tbl, r.args[i], r.args[i + 1]
      ) INTO mismatch;
      IF mismatch THEN
        RAISE EXCEPTION 'Existing cross-business reference found in %.%', r.tbl, r.args[i + 1]
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Restore immutability for the newly scoped child rows. Their parent
-- inheritance triggers run first on updates.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_paid_outs', 'customer_addresses', 'loyalty_tier_changes',
    'menu_item_modifier_groups', 'modifier_options',
    'order_items', 'order_item_modifiers',
    'payroll_entries', 'payroll_payments',
    'purchase_order_items', 'recipe_ingredients', 'stock_take_lines'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_keep_business ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_keep_business BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION keep_business_id()',
      t
    );
  END LOOP;
END $$;

-- Managers and staff have one home business. The owner is the only unassigned
-- account; keep the existing staff rows and normalize only that assignment.
DROP TRIGGER IF EXISTS trg_keep_business ON staff;
UPDATE staff SET business_id = 1 WHERE business_id IS NULL AND NOT is_owner;
UPDATE staff SET business_id = NULL WHERE is_owner AND business_id IS NOT NULL;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_business_or_owner;
ALTER TABLE staff ADD CONSTRAINT staff_business_or_owner
  CHECK ((is_owner AND business_id IS NULL) OR (NOT is_owner AND business_id IS NOT NULL));
CREATE TRIGGER trg_keep_business BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION keep_business_id();

COMMENT ON TABLE staff_businesses IS
  'Legacy migration 076 snapshot; staff.business_id is authoritative since migration 079. Retained for existing rows, not for assignment or access checks.';

-- The per-business replacements from 078/079 are now authoritative.
DO $$
DECLARE
  r record;
  c record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('timesheets', ARRAY['staff_id', 'period_start', 'period_end']),
    ('customers', ARRAY['phone']),
    ('newsletter_subscribers', ARRAY['email']),
    ('loyalty_tiers', ARRAY['name'])
  ) v(tbl, cols)
  LOOP
    FOR c IN
      SELECT con.conname FROM pg_constraint con
      WHERE con.conrelid = to_regclass(r.tbl) AND con.contype = 'u'
        AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
             FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey))
          = (SELECT array_agg(x ORDER BY x) FROM unnest(r.cols) x)
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, c.conname);
    END LOOP;
  END LOOP;
END $$;
DROP INDEX IF EXISTS customers_email_account_unique;

COMMIT;
