-- 088: orders become location-aware
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS orders_location_id ON orders(location_id);
CREATE INDEX IF NOT EXISTS orders_business_location ON orders(business_id, location_id);
