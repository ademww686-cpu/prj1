-- Production hardening and booking workflow migration.
-- Safe to run after 001_initial.sql. Existing booking rows are preserved.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
-- Preserve legacy cancelled records while moving the active workflow to rejected.
UPDATE bookings SET status='rejected', updated_at=NOW() WHERE status='cancelled';

ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending','confirmed','rejected','completed'));

-- If legacy data contains simultaneous active requests, keep every row but reject
-- duplicates deterministically before adding the database-level conflict guard.
WITH duplicates AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY booking_date, start_time
    ORDER BY created_at ASC, id ASC
  ) AS rn
  FROM bookings
  WHERE status IN ('pending','confirmed') AND archived_at IS NULL
)
UPDATE bookings b
SET status='rejected', updated_at=NOW()
FROM duplicates d
WHERE b.id=d.id AND d.rn>1;

CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS bookings_updated_at_idx ON bookings (updated_at DESC);
CREATE INDEX IF NOT EXISTS bookings_booking_date_idx ON bookings (booking_date);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_unique
  ON bookings (booking_date, start_time)
  WHERE status IN ('pending','confirmed') AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
