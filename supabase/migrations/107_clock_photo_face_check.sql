-- 107: Clock-in photos must show a face (attendance app, agreed 2026-10-03).
--   clock_in_face / clock_out_face: the phone saw a face before taking the
--     photo (true); it couldn't check and the person tapped "Take photo"
--     (false); null = no photo.
--   photo_review: the manager's check of the photos — 'ok' or 'invalid'
--     (not a real face photo), with who and when.
-- Run BEFORE merging the attendance app change (it writes these columns).
-- Safe to re-run.
BEGIN;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_in_face boolean;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS clock_out_face boolean;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo_review text;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_photo_review_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_photo_review_check CHECK (photo_review IN ('ok', 'invalid'));
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo_reviewed_by int REFERENCES staff(id);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS photo_reviewed_at timestamptz;

COMMIT;
