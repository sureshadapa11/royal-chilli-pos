-- 090: associate inventory balances, movements, and stock takes with a location.
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id);

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id);

ALTER TABLE stock_takes
  ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id);

UPDATE ingredients SET location_id = 1 WHERE location_id IS NULL;
UPDATE stock_movements SET location_id = 1 WHERE location_id IS NULL;
UPDATE stock_takes SET location_id = 1 WHERE location_id IS NULL;

ALTER TABLE stock_takes
  ALTER COLUMN location_id SET NOT NULL,
  DROP COLUMN IF EXISTS location;

CREATE INDEX IF NOT EXISTS ingredients_location_id ON ingredients(location_id);
CREATE INDEX IF NOT EXISTS stock_movements_location_id ON stock_movements(location_id);
CREATE INDEX IF NOT EXISTS stock_takes_location_id ON stock_takes(location_id);
