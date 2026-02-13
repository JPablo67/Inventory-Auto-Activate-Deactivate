-- CreateTable
CREATE TABLE "Settings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "frequencyUnit" TEXT NOT NULL DEFAULT 'days',
    "minDaysInactive" INTEGER NOT NULL DEFAULT 90,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
