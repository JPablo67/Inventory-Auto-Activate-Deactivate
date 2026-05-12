-- Add a webhook ID column to ActivityLog so we can dedup retried webhook deliveries.
-- Nullable because historical rows (and AUTO/MANUAL scan inserts) don't have one.
ALTER TABLE "ActivityLog" ADD COLUMN "webhookId" TEXT;
CREATE UNIQUE INDEX "ActivityLog_webhookId_key" ON "ActivityLog"("webhookId");
