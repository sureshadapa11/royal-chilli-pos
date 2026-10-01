-- 084 — complete the multi-business database foundation.
--
-- Migrations 076–083 introduced business scoping incrementally. This additive
-- migration fills the remaining tenant-owned tables without changing app
-- behavior; existing rows belong to The Royal Chilli (business 1).

BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'restaurant',
  ADD COLUMN IF NOT EXISTS custom_domain TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'businesses_business_type_check') THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_business_type_check
      CHECK (business_type IN ('restaurant', 'coffee_shop', 'pizza_shop', 'retail'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_custom_domain
  ON businesses (lower(custom_domain)) WHERE custom_domain IS NOT NULL;

-- Keep the original tenant and its ID stable; do not overwrite setup already
-- entered for an existing business.
INSERT INTO businesses (id, slug, name, business_type, active, display_order)
VALUES (1, 'royal-chilli', 'The Royal Chilli', 'restaurant', true, 1)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('businesses', 'id'), GREATEST((SELECT max(id) FROM businesses), 1));

-- A staff row has one business assignment. Only the group owner may have no
-- business; staff.business_id (not the legacy staff_businesses table) is the
-- canonical assignment used by the application.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS business_id INT DEFAULT 1 REFERENCES businesses(id);
ALTER TABLE staff ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;
UPDATE staff SET business_id = 1 WHERE business_id IS NULL AND NOT is_owner;
CREATE INDEX IF NOT EXISTS idx_staff_business ON staff (business_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_business_or_owner') THEN
    ALTER TABLE staff ADD CONSTRAINT staff_business_or_owner
      CHECK (business_id IS NOT NULL OR is_owner);
  END IF;
END $$;

-- Add any missing tenant scope in a nullable/backfill/NOT NULL sequence. A
-- missing historical scope is assigned to the original business, never dropped.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'order_items', 'breaks', 'clock_events', 'payroll_entries', 'payroll_payments',
    'app_settings', 'role_permissions', 'staff_availability', 'staff_hr_details',
    'staff_references', 'employee_documents', 'staff_rtw_verification',
    'staff_onboarding_tasks', 'fs_course', 'fs_training_record', 'customer_addresses',
    'loyalty_tier_changes', 'recipe_ingredients', 'modifier_options',
    'menu_item_modifier_groups', 'order_item_modifiers', 'stock_take_lines',
    'purchase_order_items', 'cash_paid_outs', 'notifications',
    'push_subscriptions', 'shift_alerts_sent', 'notification_prefs',
    'sumup_reader_events'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS business_id INT', t);
      EXECUTE format('UPDATE %I SET business_id = 1 WHERE business_id IS NULL', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN business_id SET DEFAULT 1', t);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN business_id SET NOT NULL', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass(t) AND conname = t || '_business_id_fkey'
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT',
          t, t || '_business_id_fkey'
        );
      END IF;

      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (business_id)', 'idx_' || t || '_business', t);
    END IF;
  END LOOP;
END $$;

-- Child records inherit their parent's business on insert and cannot link to a
-- different business. clock_events and breaks were retired in migration 031;
-- the existence checks keep this migration compatible with either schema.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('inherit', 'order_items',             ARRAY['orders', 'order_id']),
    ('match',   'order_items',             ARRAY['menu_items', 'menu_item_id']),
    ('inherit', 'breaks',                  ARRAY['clock_events', 'clock_event_id']),
    ('inherit', 'payroll_entries',         ARRAY['payroll_periods', 'payroll_period_id']),
    ('match',   'payroll_entries',         ARRAY['staff', 'staff_id']),
    ('inherit', 'payroll_payments',        ARRAY['payroll_entries', 'payroll_entry_id']),
    ('match',   'payroll_payments',        ARRAY['staff', 'recorded_by']),
    ('inherit', 'staff_availability',      ARRAY['staff', 'staff_id']),
    ('inherit', 'staff_hr_details',        ARRAY['staff', 'staff_id']),
    ('inherit', 'staff_references',        ARRAY['staff', 'staff_id']),
    ('inherit', 'employee_documents',      ARRAY['staff', 'staff_id']),
    ('inherit', 'staff_rtw_verification',  ARRAY['staff', 'staff_id']),
    ('inherit', 'staff_onboarding_tasks',  ARRAY['staff', 'staff_id']),
    ('inherit', 'fs_training_record',      ARRAY['staff', 'staff_id']),
    ('match',   'fs_training_record',      ARRAY['fs_course', 'course_id']),
    ('inherit', 'customer_addresses',      ARRAY['customers', 'customer_id']),
    ('inherit', 'loyalty_tier_changes',    ARRAY['customers', 'customer_id']),
    ('match',   'loyalty_tier_changes',    ARRAY['loyalty_tiers', 'from_tier_id', 'loyalty_tiers', 'to_tier_id']),
    ('inherit', 'recipe_ingredients',      ARRAY['recipes', 'recipe_id']),
    ('match',   'recipe_ingredients',      ARRAY['ingredients', 'ingredient_id']),
    ('inherit', 'modifier_options',        ARRAY['modifier_groups', 'group_id']),
    ('inherit', 'menu_item_modifier_groups', ARRAY['menu_items', 'menu_item_id']),
    ('match',   'menu_item_modifier_groups', ARRAY['modifier_groups', 'group_id']),
    ('inherit', 'order_item_modifiers',    ARRAY['order_items', 'order_item_id']),
    ('match',   'order_item_modifiers',    ARRAY['modifier_options', 'modifier_option_id']),
    ('inherit', 'stock_take_lines',        ARRAY['stock_takes', 'stock_take_id']),
    ('match',   'stock_take_lines',        ARRAY['ingredients', 'ingredient_id']),
    ('inherit', 'purchase_order_items',    ARRAY['purchase_orders', 'purchase_order_id']),
    ('match',   'purchase_order_items',    ARRAY['ingredients', 'ingredient_id']),
    ('inherit', 'cash_paid_outs',          ARRAY['work_periods', 'work_period_id']),
    ('match',   'cash_paid_outs',          ARRAY['staff', 'staff_id']),
    ('match',   'fs_check_log',            ARRAY['staff', 'staff_id']),
    ('match',   'fs_temp_log',             ARRAY['staff', 'staff_id']),
    ('match',   'fs_problem',              ARRAY['staff', 'staff_id']),
    ('match',   'fs_signoff',              ARRAY['staff', 'staff_id']),
    ('match',   'attendance_corrections',  ARRAY['staff', 'staff_id']),
    ('match',   'timesheets',              ARRAY['staff', 'staff_id']),
    ('match',   'staff_messages',          ARRAY['staff', 'created_by']),
    ('match',   'stock_movements',         ARRAY['staff', 'staff_id']),
    ('match',   'work_periods',            ARRAY['staff', 'opened_by', 'staff', 'closed_by']),
    ('match',   'orders',                  ARRAY['restaurant_tables', 'table_id', 'work_periods', 'work_period_id', 'customers', 'customer_id', 'staff', 'staff_id']),
    ('match',   'payments',                ARRAY['staff', 'staff_id']),
    ('inherit', 'notifications',           ARRAY['staff', 'staff_id']),
    ('inherit', 'push_subscriptions',      ARRAY['staff', 'staff_id']),
    ('inherit', 'notification_prefs',      ARRAY['staff', 'staff_id']),
    ('inherit', 'shift_alerts_sent',       ARRAY['shifts', 'shift_id'])
  ) v(kind, tbl, args)
  LOOP
    IF to_regclass(r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || r.kind || '_business', r.tbl);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION %I(%s)',
        'trg_' || r.kind || '_business', r.tbl,
        CASE r.kind WHEN 'inherit' THEN 'inherit_business_id' ELSE 'check_business_match' END,
        (SELECT string_agg(quote_literal(a), ', ') FROM unnest(r.args) a)
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
