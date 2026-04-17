-- Add per-shop nextRunAt to anchor scan cadence to the toggle/last-scan time.
ALTER TABLE "Settings" ADD COLUMN "nextRunAt" TIMESTAMP(3);

-- Backfill existing active shops so the next scheduler poll picks them up
-- using the new model rather than the legacy lastRunAt + frequency math.
UPDATE "Settings"
SET "nextRunAt" = COALESCE("lastRunAt", NOW())
  + (CASE WHEN "frequencyUnit" = 'minutes'
          THEN make_interval(mins => "frequency")
          ELSE make_interval(days => "frequency")
     END)
WHERE "isActive" = TRUE;
