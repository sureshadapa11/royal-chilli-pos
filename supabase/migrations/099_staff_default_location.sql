-- Every staff member works at their business's main location by default.
-- Staff with no location were refused by inventory/stock ("You aren't assigned
-- to any location") and saw nothing in location analytics. Each business has
-- one location today, so:
--   1. put every existing staff member with no location at their business's
--      main location (its first active one — same as primaryLocationId()),
--   2. do the same automatically for staff added later (either app), and when
--      a staff member is moved to another business,
--   3. when a business gets its first location, give it to its staff who
--      have none.
-- The group owner (no business) is left alone — they can use any location.
-- Staff who already have locations are never changed.

CREATE OR REPLACE FUNCTION staff_main_location(p_business_id integer)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT id FROM locations
   WHERE business_id = p_business_id AND active = 1
   ORDER BY id LIMIT 1
$$;

-- 1. Existing staff.
INSERT INTO staff_locations (staff_id, location_id)
SELECT s.id, staff_main_location(s.business_id)
  FROM staff s
 WHERE s.business_id IS NOT NULL
   AND staff_main_location(s.business_id) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM staff_locations sl WHERE sl.staff_id = s.id)
ON CONFLICT DO NOTHING;

-- 2. New staff, or staff moved to another business.
CREATE OR REPLACE FUNCTION staff_assign_main_location()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE loc integer;
BEGIN
  IF NEW.business_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.business_id IS NOT DISTINCT FROM OLD.business_id THEN RETURN NEW; END IF;
  loc := staff_main_location(NEW.business_id);
  IF loc IS NULL THEN RETURN NEW; END IF;
  -- Moved business: their old business's locations no longer apply.
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM staff_locations sl
     USING locations l
     WHERE sl.staff_id = NEW.id AND l.id = sl.location_id
       AND l.business_id IS DISTINCT FROM NEW.business_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_locations WHERE staff_id = NEW.id) THEN
    INSERT INTO staff_locations (staff_id, location_id) VALUES (NEW.id, loc) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS staff_main_location_on_insert ON staff;
CREATE TRIGGER staff_main_location_on_insert
  AFTER INSERT ON staff FOR EACH ROW EXECUTE FUNCTION staff_assign_main_location();
DROP TRIGGER IF EXISTS staff_main_location_on_move ON staff;
CREATE TRIGGER staff_main_location_on_move
  AFTER UPDATE OF business_id ON staff FOR EACH ROW EXECUTE FUNCTION staff_assign_main_location();

-- 3. A business's first location goes to its staff who have none.
CREATE OR REPLACE FUNCTION location_assign_unplaced_staff()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active = 1 AND NEW.business_id IS NOT NULL THEN
    INSERT INTO staff_locations (staff_id, location_id)
    SELECT s.id, NEW.id FROM staff s
     WHERE s.business_id = NEW.business_id
       AND NOT EXISTS (SELECT 1 FROM staff_locations sl WHERE sl.staff_id = s.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS location_assign_unplaced_staff ON locations;
CREATE TRIGGER location_assign_unplaced_staff
  AFTER INSERT ON locations FOR EACH ROW EXECUTE FUNCTION location_assign_unplaced_staff();

-- 4. Orders saved without a location (website, QR, Stripe) go to the
--    business's main location. Otherwise, once staff have a location, the
--    till's order list (which shows only their locations' orders) would miss
--    new website orders.
CREATE OR REPLACE FUNCTION orders_default_location()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.location_id IS NULL AND NEW.business_id IS NOT NULL THEN
    NEW.location_id := staff_main_location(NEW.business_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_default_location ON orders;
CREATE TRIGGER orders_default_location
  BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION orders_default_location();

UPDATE orders o SET location_id = staff_main_location(o.business_id)
 WHERE o.location_id IS NULL AND o.business_id IS NOT NULL;
