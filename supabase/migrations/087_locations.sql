-- 087: locations per business. Already applied manually in Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS locations (
  id           SERIAL PRIMARY KEY,
  business_id  INT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  address      JSONB,
  phone        TEXT,
  email        TEXT,
  active       INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS locations_business_id ON locations(business_id);
CREATE INDEX IF NOT EXISTS locations_active ON locations(active);

CREATE TABLE IF NOT EXISTS staff_locations (
  staff_id     INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  location_id  INT REFERENCES locations(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, location_id)
);
ALTER TABLE staff_locations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS staff_locations_location ON staff_locations(location_id);

ALTER TABLE pos_devices
  ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id) ON DELETE SET NULL;
