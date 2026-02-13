-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
