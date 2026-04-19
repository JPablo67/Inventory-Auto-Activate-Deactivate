-- Track when a shop's billing grace period ends. Set when subscription is
-- cancelled/expired/declined; cleared on re-subscription. Past this timestamp
-- the app hard-gates the dashboard and the scheduler skips the shop.
ALTER TABLE "Settings" ADD COLUMN "gracePeriodEndsAt" TIMESTAMP(3);
