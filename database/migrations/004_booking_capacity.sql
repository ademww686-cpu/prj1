-- Booking exclusivity is per date, time, and booking type.
-- Migration 002 already rejected legacy duplicates before installing its stricter index.
DROP INDEX IF EXISTS bookings_active_slot_unique;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_slot_type_unique
  ON bookings (booking_date, start_time, booking_type)
  WHERE status IN ('pending','confirmed') AND archived_at IS NULL;
