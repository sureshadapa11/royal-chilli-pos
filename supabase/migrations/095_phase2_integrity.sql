-- Phase 2 integrity fixes: orders, payments, deliveries and stock takes.
--
-- Run this BEFORE deploying the matching code — the routes call the
-- functions below and write orders.pay_online.
--
-- 1. orders.pay_online — the customer chose "Pay Online Now". The kitchen
--    hides such an order until its payment lands (GET /api/kitchen).
-- 2. One payment per Stripe Checkout session per order, and one cash
--    collection per delivered order, enforced by the database rather than a
--    read-then-insert check two simultaneous requests can both pass.
--    If the index fails to build there are already duplicate rows; find them with
--      SELECT order_id, reference, count(*) FROM payments
--      WHERE method = 'card_online' AND reference IS NOT NULL
--      GROUP BY 1, 2 HAVING count(*) > 1;
-- 3. record_order_payment / complete_delivery / post_stock_take — each runs
--    in one transaction with the row locked (or status flipped first), so a
--    double-click, a retry or two tills at once can't apply anything twice.
-- 4. approve_stock_takes — its own permission again. Migration 021 created
--    it, but 032 rebuilt role_permissions with tab keys only and dropped it,
--    so posting a stock take fell back to the Inventory tab permission.

BEGIN;

-- 1 ──────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_online BOOLEAN NOT NULL DEFAULT false;
-- Orders that already started a Stripe Checkout were pay-online orders.
UPDATE orders SET pay_online = true WHERE stripe_session_id IS NOT NULL AND NOT pay_online;

-- 2 ──────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS payments_online_reference_once
  ON payments (order_id, reference)
  WHERE method = 'card_online' AND reference IS NOT NULL;

DROP INDEX IF EXISTS payments_delivery_cash_once;
CREATE UNIQUE INDEX IF NOT EXISTS payments_delivery_collected_once
  ON payments (order_id)
  WHERE reference = 'delivery_collected';

-- 3 ──────────────────────────────────────────────────────────────────────────

-- A till payment. Locks the order row, so a second payment for the same
-- order waits for this one and then sees the new balance. p_amount NULL pays
-- whatever is left. The order is marked paid here once fully covered, so
-- exactly one call ever reports `fully_paid` for an order.
-- outcome: recorded | not_found | cancelled | already_paid | nothing_due | exceeds_balance
CREATE OR REPLACE FUNCTION record_order_payment(
  p_business_id  INT,
  p_order_id     INT,
  p_method       TEXT,
  p_amount       NUMERIC,
  p_tip_amount   NUMERIC DEFAULT 0,
  p_change_given NUMERIC DEFAULT 0,
  p_reference    TEXT DEFAULT NULL,
  p_staff_id     INT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o orders%ROWTYPE;
  remaining NUMERIC;
  amt NUMERIC;
  now_paid BOOLEAN;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF o.status = 'cancelled' THEN
    RETURN jsonb_build_object('outcome', 'cancelled');
  END IF;
  IF o.is_paid THEN
    RETURN jsonb_build_object('outcome', 'already_paid', 'total', o.total, 'amount_paid', o.amount_paid);
  END IF;

  remaining := round(COALESCE(o.total, 0) - COALESCE(o.amount_paid, 0), 2);
  amt := round(COALESCE(p_amount, remaining), 2);
  IF amt <= 0 THEN
    RETURN jsonb_build_object('outcome', 'nothing_due', 'total', o.total, 'amount_paid', o.amount_paid);
  END IF;
  IF amt > remaining + 0.01 THEN
    RETURN jsonb_build_object('outcome', 'exceeds_balance', 'total', o.total, 'amount_paid', o.amount_paid, 'remaining', remaining);
  END IF;

  -- trg_apply_payment_to_order adds this to orders.amount_paid.
  INSERT INTO payments (order_id, method, amount, tip_amount, change_given, reference, staff_id)
  VALUES (p_order_id, p_method, amt, COALESCE(p_tip_amount, 0), COALESCE(p_change_given, 0), p_reference, p_staff_id);

  SELECT * INTO o FROM orders WHERE id = p_order_id;
  now_paid := o.amount_paid >= o.total - 0.01;
  IF now_paid THEN
    UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'recorded',
    'amount', amt,
    'total', o.total,
    'amount_paid', o.amount_paid,
    'fully_paid', now_paid,
    'table_id', o.table_id,
    'customer_id', o.customer_id
  );
END $$;

-- A driver hands over a pay-on-delivery order: records the money still owed
-- as a payment (reference 'delivery_collected', method 'cash' or 'card' as
-- the customer paid the driver), and marks it delivered + paid,
-- all in one transaction with the order row locked.
-- outcome: delivered | not_found | not_your_delivery | wrong_status | cancelled | invalid_method
DROP FUNCTION IF EXISTS complete_delivery(INT, INT, INT);
CREATE OR REPLACE FUNCTION complete_delivery(
  p_business_id INT,
  p_order_id    INT,
  p_driver_id   INT,
  p_method      TEXT DEFAULT 'cash'
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o orders%ROWTYPE;
  due NUMERIC;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF o.driver_id IS DISTINCT FROM p_driver_id THEN
    RETURN jsonb_build_object('outcome', 'not_your_delivery');
  END IF;
  IF o.status = 'cancelled' THEN
    RETURN jsonb_build_object('outcome', 'cancelled');
  END IF;
  IF o.delivery_status IS DISTINCT FROM 'out_for_delivery' THEN
    RETURN jsonb_build_object('outcome', 'wrong_status', 'delivery_status', o.delivery_status);
  END IF;

  IF p_method NOT IN ('cash', 'card') THEN
    RETURN jsonb_build_object('outcome', 'invalid_method');
  END IF;

  due := round(COALESCE(o.total, 0) - COALESCE(o.amount_paid, 0), 2);
  IF due > 0.009 THEN
    INSERT INTO payments (order_id, method, amount, reference, staff_id)
    VALUES (p_order_id, p_method, due, 'delivery_collected', p_driver_id);
  ELSE
    due := 0;
  END IF;

  UPDATE orders
     SET delivery_status = 'delivered', status = 'paid', updated_at = NOW()
   WHERE id = p_order_id
  RETURNING * INTO o;

  RETURN jsonb_build_object('outcome', 'delivered', 'collected', due, 'order', to_jsonb(o));
END $$;

-- Posts a submitted stock take. The status flip comes first and only
-- matches a 'submitted' take, so a concurrent second post waits on the row
-- and then finds it already 'posted' — the adjustments are written once.
-- outcome: posted | not_found | wrong_status
CREATE OR REPLACE FUNCTION post_stock_take(
  p_business_id   INT,
  p_stock_take_id INT,
  p_staff_id      INT
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st stock_takes%ROWTYPE;
BEGIN
  UPDATE stock_takes
     SET status = 'posted', posted_at = NOW(), posted_by = p_staff_id
   WHERE id = p_stock_take_id AND business_id = p_business_id AND status = 'submitted'
  RETURNING * INTO st;

  IF NOT FOUND THEN
    SELECT * INTO st FROM stock_takes WHERE id = p_stock_take_id AND business_id = p_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    RETURN jsonb_build_object('outcome', 'wrong_status', 'status', st.status);
  END IF;

  -- One 'adjustment' per counted line with a variance, so the ledger ends up
  -- equal to the physical count. Uncounted lines are left alone.
  INSERT INTO stock_movements (ingredient_id, movement_type, quantity_delta, reference_type, reference_id, reason, staff_id, location_id)
  SELECT l.ingredient_id, 'adjustment', l.variance_qty, 'stock_take', st.id,
         COALESCE(l.reason_code, 'count_error'), p_staff_id, st.location_id
    FROM stock_take_lines l
   WHERE l.stock_take_id = st.id AND l.counted_qty IS NOT NULL AND l.variance_qty <> 0;

  UPDATE stock_take_lines l
     SET variance_value = round(l.variance_qty * COALESCE(i.cost_per_unit, 0), 2)
    FROM ingredients i
   WHERE i.id = l.ingredient_id AND l.stock_take_id = st.id AND l.counted_qty IS NOT NULL;

  RETURN jsonb_build_object('outcome', 'posted', 'stock_take', to_jsonb(st));
END $$;

-- Server only (service role). Never callable with the public anon key.
REVOKE ALL ON FUNCTION record_order_payment(INT, INT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_delivery(INT, INT, INT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION post_stock_take(INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_order_payment(INT, INT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_delivery(INT, INT, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION post_stock_take(INT, INT, INT) TO service_role;

-- 4 ──────────────────────────────────────────────────────────────────────────
-- Managers approve by default, as 021 intended (admin is implicit-allow in code).
INSERT INTO role_permissions (role, permission, granted)
VALUES ('manager', 'approve_stock_takes', true)
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;
