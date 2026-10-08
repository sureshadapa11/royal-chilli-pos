-- 115: Inventory phase 0 — safe receiving + a ledger nobody can rewrite
-- (agreed 2026-10-08, inventory v2 plan).
--
-- 1. receive_purchase_order — receiving a PO used to check the status, then
--    write each line's stock movement one request at a time. A double-click,
--    a retry or two devices at once could both pass the check and add the
--    delivery to stock twice, and a failure half way left half the stock in.
--    Now it's one transaction: the status flips to 'received' first (only
--    from draft/ordered), so a second call waits on the row and then finds
--    it already received. The invoice photos are attached in the same
--    transaction, so either everything saves or nothing does.
--
-- 2. stock_movements can no longer be edited or deleted. A wrong entry is
--    put right with a new, opposite movement, so the history always shows
--    how today's figure came about. (Nothing in the app edits or deletes
--    movements today.) For a deliberate data fix, a migration can wrap its
--    change in
--      ALTER TABLE stock_movements DISABLE TRIGGER trg_stock_movements_locked;
--      …
--      ALTER TABLE stock_movements ENABLE TRIGGER trg_stock_movements_locked;
--
-- Run BEFORE merging (the receive route calls the function). Safe to re-run.
BEGIN;

-- 1 ──────────────────────────────────────────────────────────────────────────
-- p_items: [{ "item_id": 12, "received_quantity": 18, "expiry_date": "2026-10-17" }, …]
-- (already checked by the route). A line left out arrives in full, as ordered.
-- outcome: received | not_found | wrong_status | photos_taken
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
  attached INT;
BEGIN
  UPDATE purchase_orders
     SET status = 'received', received_date = p_received_on
   WHERE id = p_po_id AND business_id = p_business_id AND status IN ('draft', 'ordered')
  RETURNING * INTO po;

  IF NOT FOUND THEN
    SELECT * INTO po FROM purchase_orders WHERE id = p_po_id AND business_id = p_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    RETURN jsonb_build_object('outcome', 'wrong_status', 'status', po.status);
  END IF;

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
         'Received on PO ' || po.order_number, p_staff_id, p_location_id
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

-- 2 ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION stock_movements_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements can''t be changed or deleted. Record a correcting movement instead.'
    USING ERRCODE = 'check_violation';
END $$;

DROP TRIGGER IF EXISTS trg_stock_movements_locked ON stock_movements;
CREATE TRIGGER trg_stock_movements_locked
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_locked();

COMMIT;
