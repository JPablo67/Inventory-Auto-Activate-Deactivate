-- Explicit subscription state for scheduler gating. Prior behavior inferred
-- state from gracePeriodEndsAt, which incorrectly allowed never-subscribed
-- shops to keep running. Values: "ACTIVE" | "GRACE" | "NONE".
-- Existing rows default to "NONE"; the dashboard loader writes the correct
-- status on the next visit.
ALTER TABLE "Settings" ADD COLUMN "subscriptionStatus" TEXT NOT NULL DEFAULT 'NONE';
