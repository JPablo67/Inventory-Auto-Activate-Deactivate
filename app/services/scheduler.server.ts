import db from "../db.server";
import { scanOldProducts, deactivateProducts } from "./inventory.server";
import shopify from "../shopify.server";

declare global {
    var __schedulerInterval: NodeJS.Timeout | undefined;
    var __isScanning: boolean;
}

type Logger = (message: string, isError?: boolean) => void;

export function initScheduler() {
    if (global.__schedulerInterval) {
        return;
    }

    console.log("[Scheduler] Initializing background scanner...");
    scheduleNextRun();
}

function scheduleNextRun() {
    // Clear existing to be safe
    if (global.__schedulerInterval) clearTimeout(global.__schedulerInterval);

    global.__schedulerInterval = setTimeout(async () => {
        if (global.__isScanning) {
            console.log("[Scheduler] Skip - Scan already in progress.");
            scheduleNextRun();
            return;
        }

        global.__isScanning = true;
        try {
            await runAutoScan();
        } catch (error) {
            console.error("[Scheduler] Error in scan loop:", error);
        } finally {
            global.__isScanning = false;
            scheduleNextRun();
        }
    }, 30 * 1000);
}

async function runAutoScan() {
    console.log(`[Scheduler] Tick - ${new Date().toISOString()}`);
    try {
        const now = new Date();

        // Find settings that are active and active shops
        // We need to iterate through shops that have installed the app and enabled the feature
        const settingsList = await db.settings.findMany({
            where: { isActive: true }
        });

        if (settingsList.length > 0) {
            console.log(`[Scheduler] Found ${settingsList.length} active shops.`);
        }

        for (const settings of settingsList) {
            if (shouldRun(settings, now)) {
                console.log(`[Scheduler] Running auto-scan for ${settings.shop}`);

                // Set Status: SCANNING
                await db.settings.update({
                    where: { shop: settings.shop },
                    data: { currentStatus: "Running Scan..." }
                });

                try {
                    const deactivatedItems = await executeScanForShop(settings.shop, settings.minDaysInactive);

                    // Update lastRunAt, Type, and IDLE
                    await db.settings.update({
                        where: { shop: settings.shop },
                        data: {
                            lastRunAt: now,
                            lastScanType: 'AUTO',
                            lastScanResults: JSON.stringify(deactivatedItems || []),
                            currentStatus: "IDLE"
                        }
                    });
                } catch (err) {
                    console.error(`[Scheduler] Error processing ${settings.shop}`, err);
                    // Ensure IDLE on error
                    await db.settings.update({
                        where: { shop: settings.shop },
                        data: { currentStatus: "IDLE" }
                    });
                }
            } else {
                // Log why skipped? Too verbose? Maybe only if needed.
                // console.log(`[Scheduler] Skipping ${settings.shop} - Not due yet.`);
            }
        }
    } catch (error) {
        console.error("[Scheduler] Error in runAutoScan:", error);
    }
}

function shouldRun(settings: any, now: Date) {
    if (!settings.isActive) return false;
    // If never run, run now
    if (!settings.lastRunAt) return true;

    const lastRun = new Date(settings.lastRunAt);
    const nextRun = new Date(lastRun);

    if (settings.frequencyUnit === 'minutes') {
        nextRun.setMinutes(lastRun.getMinutes() + settings.frequency);
    } else { // days
        nextRun.setDate(lastRun.getDate() + settings.frequency);
    }

    return now >= nextRun;
}

async function executeScanForShop(shop: string, minDays: number) {
    console.log(`[Scheduler] Executing scan for ${shop}...`);
    try {
        const { admin } = await shopify.unauthenticated.admin(shop);
        return await scanAndDeactivate(admin, shop, minDays);
    } catch (error) {
        console.error(`[Scheduler] Failed to authenticate scanner for ${shop}:`, error);
        throw error;
    }
}

export async function executeDebugScan(shop: string, minDays: number) {
    return executeScanForShop(shop, minDays);
}


// Logic duplicated/adapted from inventory.server.ts to work with offline client
async function scanAndDeactivate(client: any, shop: string, minDays: number, logger: Logger = console.log): Promise<any[]> {
    logger(`[Scheduler] Scanning ${shop} with threshold ${minDays} days...`);
    const cutoffMs = minDays * 24 * 60 * 60 * 1000;

    // 1. Fetch
    const query = `
    query getZeroStockProducts($cursor: String) {
      products(first: 50, query: "status:active AND inventory_total:<=0", after: $cursor) {
        pageInfo { hasNextPage, endCursor }
        nodes {
          id, title, productType,
          featuredImage { url },
          variants(first: 10) {
            nodes {
              sku,
              inventoryItem {
                tracked
                inventoryLevels(first: 1) {
                  edges { node { updatedAt, quantities(names: ["available"]) { quantity } } }
                }
              }
            }
          }
        }
      }
    }
  `;

    let hasNextPage = true;
    let cursor = null;
    const candidates: any[] = []; // Store full objects to return
    let productsChecked = 0;

    // Ensure status is Running Scan (in case called from Debug)
    // await db.settings.update({ where: { shop }, data: { currentStatus: "Running Scan..." } }); 

    while (hasNextPage) {
        try {
            const response: any = await client.graphql(query, { variables: { cursor } });
            const responseJson: any = await response.json();

            const data = responseJson.data;

            if (!data || !data.products) {
                logger(`[Scheduler] No data in response for ${shop}`, true);
                break;
            }

            const { nodes, pageInfo } = data.products;

            for (const product of nodes) {
                productsChecked++;
                if (product.productType && (product.productType.toLowerCase().includes("gift card") || product.productType === "giftcard")) continue;

                let mostRecentUpdate = 0;
                let allVariantsZero = true;

                for (const variant of product.variants.nodes) {
                    if (variant.inventoryItem?.tracked === false) {
                        allVariantsZero = false;
                        break;
                    }

                    const level = variant.inventoryItem?.inventoryLevels?.edges?.[0]?.node;
                    if (!level) continue;

                    const quantities = level.quantities || [];
                    const available = quantities.length > 0 ? quantities[0].quantity : 0;

                    if (available > 0) { allVariantsZero = false; break; }

                    const updatedAt = new Date(level.updatedAt).getTime();
                    if (updatedAt > mostRecentUpdate) mostRecentUpdate = updatedAt;
                }

                if (allVariantsZero && mostRecentUpdate > 0) {
                    const diff = Date.now() - mostRecentUpdate;
                    const daysInactive = Math.floor(diff / (1000 * 60 * 60 * 24));

                    if (diff > cutoffMs) {
                        // logger(`[Scheduler] MARKING FOR DEACTIVATION: ${product.title} (ID: ${product.id})`);
                        (product as any).daysInactive = daysInactive;
                        candidates.push(product);
                    }
                }
            }

            hasNextPage = pageInfo.hasNextPage;
            cursor = pageInfo.endCursor;

        } catch (err: any) {
            logger(`[Scheduler] Error in scan loop for ${shop}: ${err.message}`, true);
            break;
        }
    }

    logger(`[Scheduler] Scan complete for ${shop}. Checked ${productsChecked} products. Found ${candidates.length} to deactivate.`);

    const deactivatedItems: any[] = [];

    // 2. Deactivate
    // 2. Deactivate
    if (candidates.length > 0) {
        const total = candidates.length;
        let processed = 0;

        // UPDATE STATUS (Initial)
        await db.settings.update({
            where: { shop },
            data: { currentStatus: `Deactivating: 0/${total} items...` }
        });

        for (const product of candidates) {
            // Check Stop Condition
            const freshSettings = await db.settings.findUnique({ where: { shop }, select: { isActive: true } });
            if (!freshSettings?.isActive) {
                logger(`[Scheduler] Process stopped manually for ${shop}.`);
                break;
            }

            const id = product.id;
            try {
                // Combined Mutation
                const response = await client.graphql(
                    `mutation deactivateProduct($id: ID!) {
                        tagsAdd(id: $id, tags: ["auto-archived-oos"]) { userErrors { field message } }
                        productUpdate(input: {id: $id, status: DRAFT}) { userErrors { field message } }
                    }`,
                    { variables: { id } }
                );

                const responseJson = await response.json();
                const data = responseJson.data;

                const tagErrors = data?.tagsAdd?.userErrors || [];
                const updateErrors = data?.productUpdate?.userErrors || [];

                if (tagErrors.length > 0 || updateErrors.length > 0) {
                    logger(`[Scheduler] Error deactivating ${id}: ${JSON.stringify([...tagErrors, ...updateErrors])}`, true);
                } else {
                    const sku = product.variants?.nodes?.[0]?.sku || "";
                    await db.activityLog.create({
                        data: {
                            shop,
                            productId: id,
                            productTitle: product.title,
                            productSku: sku,
                            method: "AUTO",
                            action: "AUTO-DEACTIVATE"
                        }
                    });
                    deactivatedItems.push(product);
                }

            } catch (err: any) {
                logger(`[Scheduler] Failed to deactivate ${id}: ${err.message}`, true);
            } finally {
                processed++;
                // Update status every 10 items or on last item
                if (processed % 10 === 0 || processed === total) {
                    await db.settings.update({
                        where: { shop },
                        data: { currentStatus: `Deactivating: ${processed}/${total} items...` }
                    });
                }
            }
        }


    }

    return deactivatedItems;

    return deactivatedItems;
}
