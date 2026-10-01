-- 076 — Multi-business foundation (Phase 1 of 7).
--
-- One system for several businesses (The Royal Chilli, Melt House, ABCD, EFGH):
-- one database, every business-owned row tagged with business_id.
-- NOTHING changes for The Royal Chilli: every existing row becomes business 1,
-- and every new row defaults to business 1 until Phase 2 teaches the code to
-- say which business it's writing for.
--
-- Shared across the group (NO business_id): staff + HR records, customers +
-- rewards scheme, suppliers, training courses, permissions.
-- Per business: menu, tables, tills/Z reports, orders + payments, printing,
-- reservations, delivery zones, promotions, stock, purchase orders, expenses,
-- food-safety logs, rota/attendance/timesheets/payroll (per employer).
--
-- The apps talk to the database with the service-role key, which bypasses
-- row-level security, so separation is guaranteed here by triggers instead:
--   • a child row always takes its parent's business (a payment → its order's
--     business, a stock movement → its ingredient's business, …), and
--   • a row can't point at another business's row (an order can't use another
--     business's table or till shift).
--
-- Safe to re-run. Rollback: 076_multi_business_foundation_ROLLBACK.sql.

BEGIN;

-- ── Businesses ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id              SERIAL PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,              -- short id used in code/URLs
  name            TEXT NOT NULL,                     -- trading name shown to customers
  legal_name      TEXT,                              -- company name for receipts/accounts
  company_number  TEXT,
  vat_number      TEXT,
  domain          TEXT UNIQUE,                       -- website domain → business
  logo_url        TEXT,
  brand_colour    TEXT,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  -- Which parts of the system this business uses (mixed business types).
  modules         JSONB NOT NULL DEFAULT '{
    "till": true, "kitchen_display": true, "tables": true, "qr_ordering": true,
    "website": true, "online_ordering": true, "delivery": true, "reservations": true,
    "inventory": true, "rewards": true, "food_safety": true, "delivery_platforms": true
  }'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT true,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;  -- server (service role) only

-- Only The Royal Chilli is live; the others are placeholders (active = false)
-- until they're set up. ABCD / EFGH are working names.
INSERT INTO businesses (id, slug, name, domain, active, display_order) VALUES
  (1, 'royal-chilli', 'The Royal Chilli', 'www.theroyalchilli.com', true,  1),
  (3, 'abcd',         'ABCD',             NULL,                     false, 3),
  (4, 'efgh',         'EFGH',             NULL,                     false, 4)
ON CONFLICT (id) DO NOTHING;

-- Melt House: late-night gelato & dessert café, counter service with seating
-- inside and out, plus takeaway (from its current Framer site). No delivery,
-- online ordering or bookings yet; freezer temperature logs need food safety.
INSERT INTO businesses (id, slug, name, address, phone, active, display_order, modules) VALUES
  (2, 'melt-house', 'Melt House', '45 Kingsley Rd, Hounslow TW3 1PA', '+44 7777 138126', false, 2, '{
    "till": true, "kitchen_display": false, "tables": false, "qr_ordering": false,
    "website": true, "online_ordering": false, "delivery": false, "reservations": false,
    "inventory": true, "rewards": true, "food_safety": true, "delivery_platforms": false
  }'::jsonb)
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('businesses', 'id'), GREATEST((SELECT max(id) FROM businesses), 1));

-- ── Which businesses each (shared) staff member works at, and their role there ─
CREATE TABLE IF NOT EXISTS staff_businesses (
  staff_id     INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  business_id  INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'employee',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_businesses_business ON staff_businesses (business_id);
ALTER TABLE staff_businesses ENABLE ROW LEVEL SECURITY;

-- Everyone on the team today works at The Royal Chilli, in their current role.
INSERT INTO staff_businesses (staff_id, business_id, role, active)
SELECT id, 1, COALESCE(role, 'employee'), COALESCE(active, 1) = 1 FROM staff
ON CONFLICT (staff_id, business_id) DO NOTHING;

-- ── business_id on every business-owned table ────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- menu & front of house
    'menu_categories', 'menu_items', 'modifier_groups', 'featured_dishes', 'promotions',
    'restaurant_tables', 'table_requests', 'reservations', 'delivery_zones',
    -- sales & tills
    'work_periods', 'orders', 'payments', 'print_jobs',
    -- stock & costs
    'ingredients', 'recipes', 'stock_movements', 'stock_takes', 'purchase_orders',
    'supplier_payments', 'expenses',
    -- food safety (per site)
    'fs_check_type', 'fs_check_log', 'fs_temp_type', 'fs_temp_log',
    'fs_delivery_check', 'fs_problem', 'fs_signoff',
    -- staff time & pay (per employer)
    'shifts', 'attendance', 'timesheets', 'payroll_periods', 'employee_payslips', 'leave_requests',
    -- where it happened
    'audit_logs', 'loyalty_transactions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS business_id INT NOT NULL DEFAULT 1 REFERENCES businesses(id)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (business_id)', 'idx_' || t || '_business', t);
  END LOOP;
END $$;

-- platform_sales already had business_id (075); give it the foreign key too.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_sales_business_id_fkey') THEN
    ALTER TABLE platform_sales ADD CONSTRAINT platform_sales_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id);
  END IF;
END $$;

-- Date-range lookups that every report does, per business.
CREATE INDEX IF NOT EXISTS idx_orders_business_created    ON orders (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_business_created  ON payments (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_mov_business_created ON stock_movements (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attendance_business_date   ON attendance (business_id, work_date);
CREATE INDEX IF NOT EXISTS idx_shifts_business_date       ON shifts (business_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_reservations_business_date ON reservations (business_id, reservation_date);

-- ── A child row always belongs to its parent's business ──────────────────────
-- Arguments come in pairs: (parent table, foreign-key column). The first
-- linked parent wins; a row with no parent keeps the business it was given.
CREATE OR REPLACE FUNCTION inherit_business_id() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i int := 0;
  parent_id text;
  bid int;
BEGIN
  WHILE i < TG_NARGS LOOP
    parent_id := to_jsonb(NEW) ->> TG_ARGV[i + 1];
    IF parent_id IS NOT NULL THEN
      EXECUTE format('SELECT business_id FROM %I WHERE id = $1', TG_ARGV[i]) INTO bid USING parent_id::int;
      IF bid IS NOT NULL THEN
        NEW.business_id := bid;
        RETURN NEW;
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END $$;

-- ── A row can't point at another business's row ─────────────────────────────
CREATE OR REPLACE FUNCTION check_business_match() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i int := 0;
  parent_id text;
  bid int;
BEGIN
  WHILE i < TG_NARGS LOOP
    parent_id := to_jsonb(NEW) ->> TG_ARGV[i + 1];
    IF parent_id IS NOT NULL THEN
      EXECUTE format('SELECT business_id FROM %I WHERE id = $1', TG_ARGV[i]) INTO bid USING parent_id::int;
      IF bid IS NOT NULL AND bid <> NEW.business_id THEN
        RAISE EXCEPTION '% % belongs to business %, but this % is for business %',
          TG_ARGV[i], parent_id, bid, TG_TABLE_NAME, NEW.business_id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- inherit: child table, trigger args
    ('inherit', 'menu_items',        ARRAY['menu_categories', 'category_id']),
    ('inherit', 'featured_dishes',   ARRAY['menu_items', 'menu_item_id']),
    ('inherit', 'recipes',           ARRAY['menu_items', 'menu_item_id']),
    ('inherit', 'payments',          ARRAY['orders', 'order_id']),
    ('inherit', 'print_jobs',        ARRAY['orders', 'order_id']),
    ('inherit', 'table_requests',    ARRAY['restaurant_tables', 'table_id']),
    ('inherit', 'stock_movements',   ARRAY['ingredients', 'ingredient_id']),
    ('inherit', 'supplier_payments', ARRAY['purchase_orders', 'purchase_order_id']),
    ('inherit', 'fs_check_log',      ARRAY['fs_check_type', 'check_type_id']),
    ('inherit', 'fs_temp_log',       ARRAY['fs_temp_type', 'temp_type_id']),
    ('inherit', 'fs_delivery_check', ARRAY['purchase_orders', 'purchase_order_id']),
    ('inherit', 'attendance',        ARRAY['shifts', 'shift_id']),
    -- match: the row keeps its own business, links must agree with it
    ('match',   'orders',            ARRAY['restaurant_tables', 'table_id', 'work_periods', 'work_period_id']),
    ('match',   'reservations',      ARRAY['restaurant_tables', 'table_id'])
  ) v(kind, tbl, args)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || r.kind || '_business', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION %I(%s)',
      'trg_' || r.kind || '_business', r.tbl,
      CASE r.kind WHEN 'inherit' THEN 'inherit_business_id' ELSE 'check_business_match' END,
      (SELECT string_agg(quote_literal(a), ', ') FROM unnest(r.args) a)
    );
  END LOOP;
END $$;

-- ── Numbers that were unique for the whole database become unique per business ─
-- (Two businesses can both have order 0001, purchase order PO-0001, a pay
-- period for the same dates, and a food-safety sign-off for the same day.)
DO $$
DECLARE
  r record;
  c record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('orders',          ARRAY['order_number']),
    ('purchase_orders', ARRAY['order_number']),
    ('payroll_periods', ARRAY['period_start', 'period_end']),
    ('fs_signoff',      ARRAY['day'])
  ) v(tbl, cols)
  LOOP
    FOR c IN
      SELECT con.conname FROM pg_constraint con
      WHERE con.conrelid = r.tbl::regclass AND con.contype = 'u'
        AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey))
          = (SELECT array_agg(x ORDER BY x) FROM unnest(r.cols) x)
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, c.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.tbl || '_business_unique') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (business_id, %s)', r.tbl, r.tbl || '_business_unique',
        (SELECT string_agg(quote_ident(x), ', ') FROM unnest(r.cols) x));
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Checks (run after; every count should be 0):
--   SELECT count(*) FROM orders o JOIN payments p ON p.order_id = o.id WHERE p.business_id <> o.business_id;
--   SELECT count(*) FROM staff s LEFT JOIN staff_businesses sb ON sb.staff_id = s.id WHERE sb.staff_id IS NULL;
