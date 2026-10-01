-- Managed POS devices.
-- Each device belongs to exactly one business.
-- location_id remains nullable until the locations model is introduced.

CREATE TABLE IF NOT EXISTS pos_devices (
  id                  BIGSERIAL PRIMARY KEY,
  business_id         INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  location_id         BIGINT,
  device_name         TEXT NOT NULL,
  serial_number       TEXT,
  device_fingerprint  TEXT,
  registration_code_hash TEXT,
  pairing_status      TEXT NOT NULL DEFAULT 'unpaired'
                      CHECK (pairing_status IN ('unpaired', 'pending', 'paired')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paired', 'active', 'offline', 'disabled', 'maintenance')),
  app_version         TEXT,
  last_seen_at        TIMESTAMPTZ,
  paired_at           TIMESTAMPTZ,
  disabled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_devices_business_idx
  ON pos_devices (business_id);

CREATE INDEX IF NOT EXISTS pos_devices_location_idx
  ON pos_devices (business_id, location_id);

CREATE UNIQUE INDEX IF NOT EXISTS pos_devices_business_serial_unique
  ON pos_devices (business_id, serial_number)
  WHERE serial_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_devices_business_fingerprint_unique
  ON pos_devices (business_id, device_fingerprint)
  WHERE device_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_devices_active_idx
  ON pos_devices (business_id, status)
  WHERE status IN ('pending', 'paired', 'active', 'maintenance');

CREATE OR REPLACE FUNCTION update_pos_devices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pos_devices_updated_at ON pos_devices;

CREATE TRIGGER trg_pos_devices_updated_at
BEFORE UPDATE ON pos_devices
FOR EACH ROW
EXECUTE FUNCTION update_pos_devices_updated_at();

-- Add the table to the server-side business scoping allow-list.
-- This is harmless if the entry already exists in a later migration.