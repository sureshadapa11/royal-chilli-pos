-- Give the existing staff their new roles (agreed 2026-10-03). Run AFTER the
-- roles code is live in BOTH apps (POS and attendance) — before that, the
-- attendance app doesn't know Supervisor or Kitchen and would sign them out.
--   Super admin: the group owner (already admin, unchanged)
--   Supervisor:  Suresh
--   Manager:     Royalchilli, Melthouse (were admin), Dilip (unchanged)
--   Front House: Monika, Namitha, Shweta (unchanged)
--   Kitchen:     Anusha, Srikanth, Sudheer, Vijay
-- Matched on id AND name so a wrong id can't change the wrong person.

BEGIN;

UPDATE staff SET role = 'supervisor' WHERE id = 25 AND name = 'Suresh';
UPDATE staff SET role = 'manager'    WHERE id = 1  AND name = 'Royalchilli' AND NOT is_owner;
UPDATE staff SET role = 'manager'    WHERE id = 27 AND name = 'Melthouse'   AND NOT is_owner;
UPDATE staff SET role = 'kitchen'    WHERE (id, name) IN ((22, 'Anusha'), (23, 'Srikanth'), (24, 'Sudheer'), (19, 'Vijay'));

-- Exactly one Super admin: the group owner.
DO $$
BEGIN
  IF (SELECT count(*) FROM staff WHERE role = 'admin' AND active = 1) <> 1
     OR NOT EXISTS (SELECT 1 FROM staff WHERE role = 'admin' AND is_owner) THEN
    RAISE EXCEPTION 'Expected exactly one Super admin (the group owner) — nothing changed';
  END IF;
END $$;

INSERT INTO audit_logs (business_id, staff_id, action, entity_type, entity_id, changes)
SELECT s.business_id, 26, 'roles_v2', 'staff', s.id,
       jsonb_build_object('role', s.role, 'note', 'New six-role setup')
  FROM staff s WHERE s.id IN (1, 19, 22, 23, 24, 25, 27) AND s.business_id IS NOT NULL;

COMMIT;

SELECT id, name, role FROM staff WHERE active = 1 ORDER BY role, name;
