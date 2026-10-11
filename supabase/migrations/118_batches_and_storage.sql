-- 118: Inventory phase 3 — batches, use-by dates and storage areas
-- (agreed 2026-10-08, inventory v2 plan).
--
-- 1. storage_areas — each branch's fridges, freezers and stores. Managers add
--    and remove them (a removed area is hidden, never deleted, so old
--    batches still say where they were).
--
-- 2. inventory_batches — a delivery line received WITH a use-by date becomes
--    a batch: how much came, how much is left, its use-by, where it's kept.
--    Stock received without a date stays a plain number, as before. The
--    stock ledger (stock_movements) stays the source of truth for how much
--    there is; batches say which dates that stock carries.
--
-- 3. First expiry, first out — every movement that takes stock away (sales,
--    waste, stock-take shortfalls) is taken from that ingredient's batches,
--    earliest use-by first (a movement naming a batch takes from that batch
--    first). batch_movements records which batch each movement used, so any
--    sale or waste can be traced to its delivery. Anything beyond the dated
--    batches comes out of the undated stock.
--
-- 4. receive_purchase_order — a line with a use-by date makes a batch, in the
--    storage area chosen (optional); its stock movement points at the batch.
--
-- 5. bin_expired_batch — "Bin it": writes off what's left of an expired batch
--    as waste (reason "Expired"), with who and when.
--
-- Run BEFORE merging (or straight after — the old code doesn't send the new
-- fields). Safe to re-run.
BEGIN;

-- 1 ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS storage_areas (
  id          SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  location_id INT NOT NULL REFERENCES locations(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'fridge' CHECK (kind IN ('fridge', 'freezer', 'dry', 'other')),
  active      BOOLEAN NOT NULL DEFAULT true,
  created_by  INT REFERENCES staff(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS storage_areas_name_once
  ON storage_areas (location_id, lower(btrim(name))) WHERE active;
ALTER TABLE storage_areas ENABLE ROW LEVEL SECURITY;

-- 2 ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_batches (
  id                     SERIAL PRIMARY KEY,
  business_id            INT REFERENCES businesses(id),
  ingredient_id          INT NOT NULL REFERENCES ingredients(id),
  location_id            INT REFERENCES locations(id),
  storage_area_id        INT REFERENCES storage_areas(id),
  purchase_order_item_id INT REFERENCES purchase_order_items(id),
  expiry_date            DATE NOT NULL,
  received_qty           NUMERIC(12,3) NOT NULL CHECK (received_qty > 0),
  remaining_qty          NUMERIC(12,3) NOT NULL CHECK (remaining_qty >= 0),
  unit_cost              NUMERIC(10,4),
  received_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_fefo ON inventory_batches (ingredient_id, expiry_date, id) WHERE remaining_qty > 0;
CREATE INDEX IF NOT EXISTS idx_batches_open ON inventory_batches (business_id, expiry_date) WHERE remaining_qty > 0;
ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_inherit_business ON inventory_batches;
CREATE TRIGGER trg_inherit_business BEFORE INSERT ON inventory_batches
  FOR EACH ROW EXECUTE FUNCTION inherit_business_id('ingredients', 'ingredient_id');

-- Which batch each stock movement took from (or put into).
CREATE TABLE IF NOT EXISTS batch_movements (
  id                SERIAL PRIMARY KEY,
  business_id       INT REFERENCES businesses(id),
  batch_id          INT NOT NULL REFERENCES inventory_batches(id),
  stock_movement_id INT NOT NULL REFERENCES stock_movements(id),
  quantity          NUMERIC(12,3) NOT NULL,   -- + into the batch, − out of it
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_movements_batch ON batch_movements (batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_movements_movement ON batch_movements (stock_movement_id);
ALTER TABLE batch_movements ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_inherit_business ON batch_movements;
CREATE TRIGGER trg_inherit_business BEFORE INSERT ON batch_movements
  FOR EACH ROW EXECUTE FUNCTION inherit_business_id('inventory_batches', 'batch_id');

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS batch_id INT REFERENCES inventory_batches(id);
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS storage_area_id INT REFERENCES storage_areas(id);

-- 3 ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION take_from_batches() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  need NUMERIC := -NEW.quantity_delta;
  b    RECORD;
  take NUMERIC;
BEGIN
  IF NEW.quantity_delta >= 0 THEN
    RETURN NEW;
  END IF;
  -- The named batch first (e.g. "Bin it"), then earliest use-by first.
  -- Locked, so two sales at once can't both take the same kilos.
  FOR b IN
    SELECT id, remaining_qty FROM inventory_batches
     WHERE ingredient_id = NEW.ingredient_id AND remaining_qty > 0
     ORDER BY (id = NEW.batch_id) DESC NULLS LAST, expiry_date, id
     FOR UPDATE
  LOOP
    EXIT WHEN need <= 0;
    take := LEAST(need, b.remaining_qty);
    UPDATE inventory_batches SET remaining_qty = remaining_qty - take WHERE id = b.id;
    INSERT INTO batch_movements (batch_id, stock_movement_id, quantity) VALUES (b.id, NEW.id, -take);
    need := need - take;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_take_from_batches ON stock_movements;
CREATE TRIGGER trg_take_from_batches AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION take_from_batches();

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
  SELECT i.id, i.ingredient_id, i.quantity AS ordered, i.unit_cost AS ordered_cost,
         COALESCE(o.unit_cost, i.unit_cost) AS unit_cost,
         GREATEST(0, COALESCE(o.received_quantity, i.quantity)) AS arrived,
         LEAST(GREATEST(0, COALESCE(o.rejected_quantity, 0)), GREATEST(0, COALESCE(o.received_quantity, i.quantity))) AS rejected,
         o.rejection_reason,
         o.expiry_date,
         o.storage_area_id
    FROM purchase_order_items i
    LEFT JOIN (
      SELECT DISTINCT ON (item_id) *
        FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb))
          AS x(item_id INT, received_quantity NUMERIC, expiry_date DATE, unit_cost NUMERIC,
               rejected_quantity NUMERIC, rejection_reason TEXT, storage_area_id INT)
    ) o ON o.item_id = i.id
   WHERE i.purchase_order_id = po.id;
  -- Only what was accepted goes into stock.
  ALTER TABLE _received ADD COLUMN qty NUMERIC;
  ALTER TABLE _received ADD COLUMN batch_id INT;
  UPDATE _received SET qty = arrived - rejected;
  -- A storage area must be one of this branch's, still in use.
  UPDATE _received r SET storage_area_id = NULL
   WHERE r.storage_area_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM storage_areas a
      WHERE a.id = r.storage_area_id AND a.business_id = p_business_id AND a.location_id = loc AND a.active);

  -- A line received with a use-by date becomes a batch.
  WITH made AS (
    INSERT INTO inventory_batches (ingredient_id, location_id, storage_area_id, purchase_order_item_id, expiry_date, received_qty, remaining_qty, unit_cost)
    SELECT r.ingredient_id, loc, r.storage_area_id, r.id, r.expiry_date, r.qty, r.qty, r.unit_cost
      FROM _received r
     WHERE r.qty > 0 AND r.expiry_date IS NOT NULL
    RETURNING id, purchase_order_item_id
  )
  UPDATE _received r SET batch_id = made.id FROM made WHERE made.purchase_order_item_id = r.id;

  UPDATE purchase_order_items i
     SET received_quantity = r.qty, rejected_quantity = r.rejected,
         rejection_reason = CASE WHEN r.rejected > 0 THEN r.rejection_reason END,
         expiry_date = r.expiry_date, received_unit_cost = r.unit_cost,
         storage_area_id = r.storage_area_id
    FROM _received r
   WHERE i.id = r.id;

  -- Nothing arrived on a line → no movement and the last-known cost stays.
  WITH moved AS (
    INSERT INTO stock_movements (ingredient_id, movement_type, quantity_delta, reference_type, reference_id, reason, staff_id, location_id, batch_id)
    SELECT r.ingredient_id, 'purchase', r.qty, 'purchase_order', po.id,
           'Received on PO ' || po.order_number, p_staff_id, loc, r.batch_id
      FROM _received r
     WHERE r.qty > 0
    RETURNING id, batch_id, quantity_delta
  )
  INSERT INTO batch_movements (batch_id, stock_movement_id, quantity)
  SELECT batch_id, id, quantity_delta FROM moved WHERE batch_id IS NOT NULL;

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

-- 5 ──────────────────────────────────────────────────────────────────────────
-- outcome: binned | not_found | not_expired | empty
CREATE OR REPLACE FUNCTION bin_expired_batch(
  p_business_id INT,
  p_batch_id    INT,
  p_staff_id    INT
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  b inventory_batches%ROWTYPE;
  qty NUMERIC;
BEGIN
  SELECT * INTO b FROM inventory_batches
   WHERE id = p_batch_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  -- Use-by is a UK calendar date: expired from the day after it.
  IF b.expiry_date >= (NOW() AT TIME ZONE 'Europe/London')::date THEN
    RETURN jsonb_build_object('outcome', 'not_expired');
  END IF;
  qty := b.remaining_qty;
  IF qty <= 0 THEN
    RETURN jsonb_build_object('outcome', 'empty');
  END IF;

  -- take_from_batches takes it from this batch (it's named).
  INSERT INTO stock_movements (ingredient_id, movement_type, quantity_delta, reference_type, reference_id, reason, staff_id, location_id, batch_id)
  VALUES (b.ingredient_id, 'waste', -qty, 'batch', b.id, 'Expired', p_staff_id, b.location_id, b.id);

  RETURN jsonb_build_object('outcome', 'binned', 'quantity', qty);
END $$;

REVOKE ALL ON FUNCTION receive_purchase_order(INT, INT, JSONB, INT[], INT, INT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_purchase_order(INT, INT, JSONB, INT[], INT, INT, DATE) TO service_role;
REVOKE ALL ON FUNCTION bin_expired_batch(INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bin_expired_batch(INT, INT, INT) TO service_role;

COMMIT;
