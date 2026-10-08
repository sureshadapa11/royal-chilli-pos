-- 116: Inventory phase 1 — stock requests from the kitchen + purchase order
-- approval (agreed 2026-10-08, inventory v2 plan).
--
-- 1. Purchase order stages:
--      draft → (submit) → awaiting_approval → (approve) → approved
--                        ↘ (under the limit) ─────────────↗
--      approved → (mark sent) → ordered → (receive) → received
--      awaiting_approval → (reject) → rejected
--      draft / awaiting_approval / approved / ordered → (cancel) → cancelled
--    Orders over the business's limit (setting po_approval_limit, default
--    £150) need approving by someone with the "Approve purchase orders" tick
--    — never the person who created it, except a Super admin. The rules live
--    in lib/purchase-orders.ts; move_purchase_order makes each move safely.
--    purchase_orders.location_id: the branch the order is for (stock goes in
--    there when it's received).
--
-- 2. purchase_order_events — who did what to each order, when, and why.
--    Append-only: rows can't be changed or deleted.
--
-- 3. stock_requests — the Kitchen Display's "Request stock". A manager turns
--    open requests into a purchase order, or declines them with a reason.
--
-- 4. receive_purchase_order (115) now only receives an approved or sent
--    order, puts the stock into the order's own branch, and logs the event.
--
-- 5. New permission tick approve_purchase_orders — Managers full.
--
-- Run BEFORE merging. Safe to re-run.
BEGIN;

-- 1 ──────────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'awaiting_approval', 'approved', 'ordered', 'received', 'rejected', 'cancelled'));

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES staff(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 2 ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_events (
  id                SERIAL PRIMARY KEY,
  business_id       INT REFERENCES businesses(id),
  purchase_order_id INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  action            TEXT NOT NULL,   -- created | submitted | auto_approved | approved | rejected | sent | cancelled | received
  from_status       TEXT,
  to_status         TEXT NOT NULL,
  staff_id          INT REFERENCES staff(id),
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_events_po ON purchase_order_events (purchase_order_id, id);
ALTER TABLE purchase_order_events ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_inherit_business ON purchase_order_events;
CREATE TRIGGER trg_inherit_business BEFORE INSERT ON purchase_order_events
  FOR EACH ROW EXECUTE FUNCTION inherit_business_id('purchase_orders', 'purchase_order_id');

CREATE OR REPLACE FUNCTION purchase_order_events_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The purchase order history can''t be changed.' USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_po_events_locked ON purchase_order_events;
CREATE TRIGGER trg_po_events_locked BEFORE UPDATE ON purchase_order_events
  FOR EACH ROW EXECUTE FUNCTION purchase_order_events_locked();
-- (DELETE is left to ON DELETE CASCADE only; the app never deletes POs or events.)

-- Every new order starts its history.
CREATE OR REPLACE FUNCTION log_purchase_order_created() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO purchase_order_events (purchase_order_id, action, from_status, to_status, staff_id)
  VALUES (NEW.id, 'created', NULL, NEW.status, NEW.created_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_created ON purchase_orders;
CREATE TRIGGER trg_po_created AFTER INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION log_purchase_order_created();

-- One move from one stage to the next, in one transaction: the update only
-- matches while the order is still in one of p_from, so two people pressing
-- Approve at once can't both win, and the history line is written with it.
-- outcome: moved | not_found | wrong_status
CREATE OR REPLACE FUNCTION move_purchase_order(
  p_business_id INT,
  p_po_id       INT,
  p_from        TEXT[],
  p_to          TEXT,
  p_action      TEXT,
  p_staff_id    INT,
  p_comment     TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  po purchase_orders%ROWTYPE;
  was TEXT;
BEGIN
  SELECT status INTO was FROM purchase_orders
   WHERE id = p_po_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF NOT (was = ANY (p_from)) THEN
    RETURN jsonb_build_object('outcome', 'wrong_status', 'status', was);
  END IF;

  UPDATE purchase_orders
     SET status = p_to,
         approved_by = CASE WHEN p_to = 'approved' THEN p_staff_id ELSE approved_by END,
         approved_at = CASE WHEN p_to = 'approved' THEN NOW() ELSE approved_at END
   WHERE id = p_po_id
  RETURNING * INTO po;

  INSERT INTO purchase_order_events (purchase_order_id, action, from_status, to_status, staff_id, comment)
  VALUES (p_po_id, p_action, was, p_to, p_staff_id, NULLIF(btrim(COALESCE(p_comment, '')), ''));

  -- A rejected or cancelled order gives its kitchen requests back, so they
  -- can go on another order.
  IF p_to IN ('rejected', 'cancelled') THEN
    UPDATE stock_requests SET status = 'open', purchase_order_id = NULL, handled_by = NULL, handled_at = NULL
     WHERE purchase_order_id = p_po_id AND status = 'ordered';
  END IF;

  RETURN jsonb_build_object('outcome', 'moved', 'purchase_order', to_jsonb(po));
END $$;

-- 3 ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_requests (
  id                SERIAL PRIMARY KEY,
  business_id       INT NOT NULL REFERENCES businesses(id),
  location_id       INT REFERENCES locations(id),
  ingredient_id     INT REFERENCES ingredients(id),
  item_name         TEXT,            -- something not on the ingredients list
  quantity          NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit              TEXT,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ordered', 'declined')),
  requested_by      INT REFERENCES staff(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_by        INT REFERENCES staff(id),
  handled_at        TIMESTAMPTZ,
  purchase_order_id INT REFERENCES purchase_orders(id),
  decline_reason    TEXT,
  CHECK (ingredient_id IS NOT NULL OR NULLIF(btrim(item_name), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_requests_open ON stock_requests (business_id, status, created_at);
ALTER TABLE stock_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_match_business ON stock_requests;
CREATE TRIGGER trg_match_business BEFORE INSERT OR UPDATE ON stock_requests
  FOR EACH ROW EXECUTE FUNCTION check_business_match('ingredients', 'ingredient_id', 'purchase_orders', 'purchase_order_id');

-- 4 ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_business_id INT,
  p_po_id       INT,
  p_items       JSONB,
  p_receipt_ids INT[],
  p_staff_id    INT,
  p_location_id INT,
  p_received_on DATE
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  po purchase_orders%ROWTYPE;
  was TEXT;
  loc INT;
  attached INT;
BEGIN
  SELECT status INTO was FROM purchase_orders
   WHERE id = p_po_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF was NOT IN ('approved', 'ordered') THEN
    RETURN jsonb_build_object('outcome', 'wrong_status', 'status', was);
  END IF;

  UPDATE purchase_orders
     SET status = 'received', received_date = p_received_on
   WHERE id = p_po_id
  RETURNING * INTO po;
  loc := COALESCE(po.location_id, p_location_id);

  -- What actually arrived, per line. A line sent twice counts once.
  DROP TABLE IF EXISTS _received;
  CREATE TEMP TABLE _received ON COMMIT DROP AS
  SELECT i.id, i.ingredient_id, i.unit_cost,
         GREATEST(0, COALESCE(o.received_quantity, i.quantity)) AS qty,
         o.expiry_date
    FROM purchase_order_items i
    LEFT JOIN (
      SELECT DISTINCT ON (item_id) *
        FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
          AS x(item_id INT, received_quantity NUMERIC, expiry_date DATE)
    ) o ON o.item_id = i.id
   WHERE i.purchase_order_id = po.id;

  UPDATE purchase_order_items i
     SET received_quantity = r.qty, expiry_date = r.expiry_date
    FROM _received r
   WHERE i.id = r.id;

  -- Nothing arrived on a line → no movement and the last-known cost stays.
  INSERT INTO stock_movements (ingredient_id, movement_type, quantity_delta, reference_type, reference_id, reason, staff_id, location_id)
  SELECT r.ingredient_id, 'purchase', r.qty, 'purchase_order', po.id,
         'Received on PO ' || po.order_number, p_staff_id, loc
    FROM _received r
   WHERE r.qty > 0;

  -- Last-known cost, used for recipe costing.
  UPDATE ingredients g
     SET cost_per_unit = r.unit_cost
    FROM _received r
   WHERE g.id = r.ingredient_id AND r.qty > 0;

  -- What the delivery actually cost — the ingredient cost in the P&L, so a
  -- short delivery doesn't still count at the ordered total.
  UPDATE purchase_orders
     SET total_cost = (SELECT round(COALESCE(SUM(qty * unit_cost), 0), 2) FROM _received)
   WHERE id = po.id
  RETURNING * INTO po;

  INSERT INTO purchase_order_events (purchase_order_id, action, from_status, to_status, staff_id)
  VALUES (po.id, 'received', was, 'received', p_staff_id);

  -- The invoice photos (checked by the route). If one was used elsewhere in
  -- the meantime, undo the whole receipt.
  UPDATE receipt_photos
     SET entity_type = 'purchase_order', entity_id = po.id, attached_at = NOW()
   WHERE business_id = p_business_id AND id = ANY (p_receipt_ids) AND entity_type IS NULL;
  GET DIAGNOSTICS attached = ROW_COUNT;
  IF attached < COALESCE(array_length(p_receipt_ids, 1), 0) THEN
    RAISE EXCEPTION 'photos_taken' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('outcome', 'received', 'purchase_order', to_jsonb(po));
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'photos_taken' THEN
      RETURN jsonb_build_object('outcome', 'photos_taken');
    END IF;
    RAISE;
END $$;

REVOKE ALL ON FUNCTION move_purchase_order(INT, INT, TEXT[], TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION move_purchase_order(INT, INT, TEXT[], TEXT, TEXT, INT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION receive_purchase_order(INT, INT, JSONB, INT[], INT, INT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_purchase_order(INT, INT, JSONB, INT[], INT, INT, DATE) TO service_role;

-- 5 ──────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role, permission, level, granted)
VALUES ('manager', 'approve_purchase_orders', 'full', true),
       ('hr',      'approve_purchase_orders', 'off',  false)
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;
