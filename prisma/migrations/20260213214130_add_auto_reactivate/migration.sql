-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "autoReactivate" BOOLEAN NOT NULL DEFAULT true,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "frequencyUnit" TEXT NOT NULL DEFAULT 'days',
    "minDaysInactive" INTEGER NOT NULL DEFAULT 90,
    "lastRunAt" DATETIME,
    "lastScanType" TEXT,
    "lastScanResults" TEXT,
    "currentStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("createdAt", "currentStatus", "frequency", "frequencyUnit", "isActive", "lastRunAt", "lastScanResults", "lastScanType", "minDaysInactive", "shop", "updatedAt") SELECT "createdAt", "currentStatus", "frequency", "frequencyUnit", "isActive", "lastRunAt", "lastScanResults", "lastScanType", "minDaysInactive", "shop", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
