-- 117: Inventory phase 2 — what was refused at the door (agreed 2026-10-08,
-- inventory v2 plan).
--
-- At Receive, each line now records what arrived, what was refused and why
-- (damaged, wrong item, short-dated, temperature, quality, other). Only the
-- accepted amount goes into stock and into the cost. A delivery always
-- closes the order: anything not delivered or refused is the shortfall,
-- written into the order's history and flagged on the list
-- (purchase_orders.short_delivery) — the supplier isn't waited on for the
-- rest.
--
--   purchase_order_items.received_quantity  = accepted (into stock), as before
--   purchase_order_items.rejected_quantity  = refused at the door
--   delivered = received + rejected; not delivered = ordered − delivered
--
-- Temperatures stay in Food Safety → delivery checks (attendance app); the
-- Receive screen shows that check rather than asking again.
--
-- Run BEFORE merging (or straight after — the old code doesn't send the new
-- fields). Safe to re-run.
BEGIN;

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS rejected_quantity NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_rejection_reason_check;
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_order_items_rejection_reason_check
  CHECK (rejection_reason IS NULL OR rejection_reason IN ('damaged', 'wrong_item', 'short_dated', 'temperature', 'quality', 'other'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS short_delivery BOOLEAN NOT NULL DEFAULT false;

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
  SELECT i.id, i.ingredient_id, i.quantity AS ordered, i.unit_cost AS ordered_cost,
         COALESCE(o.unit_cost, i.unit_cost) AS unit_cost,
         GREATEST(0, COALESCE(o.received_quantity, i.quantity)) AS arrived,
         LEAST(GREATEST(0, COALESCE(o.rejected_quantity, 0)), GREATEST(0, COALESCE(o.received_quantity, i.quantity))) AS rejected,
         o.rejection_reason,
         o.expiry_date
    FROM purchase_order_items i
    LEFT JOIN (
      SELECT DISTINCT ON (item_id) *
        FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
          AS x(item_id INT, received_quantity NUMERIC, expiry_date DATE, unit_cost NUMERIC,
               rejected_quantity NUMERIC, rejection_reason TEXT)
    ) o ON o.item_id = i.id
   WHERE i.purchase_order_id = po.id;
  -- Only what was accepted goes into stock.
  ALTER TABLE _received ADD COLUMN qty NUMERIC;
  UPDATE _received SET qty = arrived - rejected;

  UPDATE purchase_order_items i
     SET received_quantity = r.qty, rejected_quantity = r.rejected,
         rejection_reason = CASE WHEN r.rejected > 0 THEN r.rejection_reason END,
         expiry_date = r.expiry_date, received_unit_cost = r.unit_cost
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
     SET total_cost = (SELECT round(COALESCE(SUM(qty * unit_cost), 0), 2) FROM _received),
         -- Closed with a shortfall: less arrived than ordered, or some refused.
         short_delivery = EXISTS (SELECT 1 FROM _received WHERE arrived < ordered OR rejected > 0)
   WHERE id = po.id
  RETURNING * INTO po;

  -- e.g. "Not delivered: Lamb Leg 2 kg. Rejected: Chicken Breast 2 kg (damaged).
  --        Price changed: Chicken Breast £6.00 → £6.40"
  INSERT INTO purchase_order_events (purchase_order_id, action, from_status, to_status, staff_id, comment)
  VALUES (po.id, 'received', was, 'received', p_staff_id, NULLIF(concat_ws(' ',
    (SELECT 'Not delivered: ' || string_agg(g.name || ' ' || trim_scale(r.ordered - r.arrived) || ' ' || g.unit, ', ' ORDER BY g.name) || '.'
       FROM _received r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.arrived < r.ordered),
    (SELECT 'Rejected: ' || string_agg(g.name || ' ' || trim_scale(r.rejected) || ' ' || g.unit || ' (' || replace(COALESCE(r.rejection_reason, 'other'), '_', ' ') || ')', ', ' ORDER BY g.name) || '.'
       FROM _received r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.rejected > 0),
    (SELECT 'Price changed: ' || string_agg(g.name || ' £' || to_char(r.ordered_cost, 'FM999990.00') || ' → £' || to_char(r.unit_cost, 'FM999990.00'), ', ' ORDER BY g.name)
       FROM _received r JOIN ingredients g ON g.id = r.ingredient_id WHERE r.qty > 0 AND r.unit_cost <> r.ordered_cost)
  ), ''));

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

REVOKE ALL ON FUNCTION receive_purchase_order(INT, INT, JSONB, INT[], INT, INT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_purchase_order(INT, INT, JSONB, INT[], INT, INT, DATE) TO service_role;

COMMIT;
