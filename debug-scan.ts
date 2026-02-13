
import { PrismaClient } from "@prisma/client";
import { initScheduler } from "./app/services/scheduler.server";
import db from "./app/db.server";

async function debugAutoScan() {
    console.log("Starting debug manual trigger...");

    // 1. Force init scheduler (idempotent)
    initScheduler();

    // 2. Fetch settings
    const settings = await db.settings.findFirst();
    console.log("Found settings:", settings);

    if (!settings) {
        console.error("No settings found in DB!");
        return;
    }

    // 3. Reset lastRunAt to force a run
    console.log("Resetting lastRunAt to past...");
    await db.settings.update({
        where: { shop: settings.shop },
        data: { lastRunAt: new Date(Date.now() - 10000000) } // Way in the past
    });

    console.log("Waiting for scheduler (runs every 60s)... or we can manually invoke if we export logic.");
    // Since runAutoScan is not exported, we wait or we can export it.
    // Actually, let's keep it simple and just observe or use the existing scheduler if it's running.

    // NOTE: This script just resets the timer. The actual run depends on the app server being up.
    // If we want to run the LOGIC here, we need to import runAutoScan or copy it.
    // But runAutoScan depends on 'shopify' server config which might need an improperly set up context in a standalone script.
}

debugAutoScan();
