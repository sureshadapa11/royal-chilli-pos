-- 089: Set all existing orders to location 1 for backward compatibility
UPDATE orders SET location_id = 1 WHERE location_id IS NULL;
