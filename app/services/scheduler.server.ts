import db from "../db.server";
import { scanOldProducts, deactivateProducts } from "./inventory.server";
import shopify from "../shopify.server";

let schedulerStarted = false;

export function initScheduler() {
    if (schedulerStarted) return;
    schedulerStarted = true;

    console.log("[Scheduler] Initialized background scanner.");

    // Run every minute
    setInterval(runAutoScan, 60 * 1000);
}

async function runAutoScan() {
    try {
        const now = new Date();

        // Find settings that are active and active shops
        // We need to iterate through shops that have installed the app and enabled the feature
        const settingsList = await db.settings.findMany({
            where: { isActive: true }
        });

        for (const settings of settingsList) {
            if (shouldRun(settings, now)) {
                console.log(`[Scheduler] Running auto-scan for ${settings.shop}`);
                const deactivatedItems = await executeScanForShop(settings.shop, settings.minDaysInactive);

                // Update lastRunAt and Type
                await db.settings.update({
                    where: { shop: settings.shop },
                    data: {
                        lastRunAt: now,
                        lastScanType: 'AUTO',
                        lastScanResults: JSON.stringify(deactivatedItems || [])
                    }
                });
            }
        }
    } catch (error) {
        console.error("[Scheduler] Error in runAutoScan:", error);
    }
}

function shouldRun(settings: any, now: Date): boolean {
    if (!settings.lastRunAt) return true;

    const lastRun = new Date(settings.lastRunAt).getTime();
    const current = now.getTime();
    const diffMs = current - lastRun;

    let frequencyMs = 0;
    if (settings.frequencyUnit === "minutes") {
        frequencyMs = settings.frequency * 60 * 1000;
    } else {
        // days
        frequencyMs = settings.frequency * 24 * 60 * 60 * 1000;
    }

    return diffMs >= frequencyMs;
}

async function executeScanForShop(shop: string, minDays: number) {
    try {
        // Use unauthenticated.admin for background tasks
        const { admin } = await shopify.unauthenticated.admin(shop);

        // Wrap to match client interface expected by scanAndDeactivate
        // Or refactor scanAndDeactivate. For least disturbance, I'll wrap here.
        const client = {
            request: async (query: string, options: any) => {
                const response = await admin.graphql(query, options);
                const json = await response.json();
                return { body: json };
            }
        };

        const deactivatedItems = await scanAndDeactivate(client, shop, minDays);
        return deactivatedItems;

    } catch (error) {
        console.error(`[Scheduler] Error executing scan for ${shop}:`, error);
        return [];
    }
}

// Helper to log to console or array
type Logger = (msg: string, isError?: boolean) => void;

export async function executeDebugScan(shop: string, admin?: any): Promise<string[]> {
    const logs: string[] = [];
    const logger: Logger = (msg, isError) => {
        logs.push(msg);
        if (isError) console.error(msg);
        else console.log(msg);
    };

    logger(`Starting debug scan for ${shop}`);

    // DEBUG: Check shopify object
    try {
        logger(`Shopify keys: ${Object.keys(shopify).join(', ')}`);
        if ((shopify as any).api) {
            logger(`Shopify API keys: ${Object.keys((shopify as any).api).join(', ')}`);
        } else {
            logger(`Shopify.api is undefined!`);
        }
    } catch (e) {
        logger(`Error checking shopify object: ${e}`);
    }

    // 1. Fetch settings to get minDays
    const settings = await db.settings.findUnique({ where: { shop } });
    if (!settings) {
        logger("No settings found", true);
        return logs;
    }
    logger(`Settings found: minDaysInactive=${settings.minDaysInactive}`);

    let adminClient;

    if (admin) {
        logger("Using provided Admin context (Online/Debug)");
        // The provided adminContext is already the Remix-style admin object
        adminClient = admin;
    } else {
        // 2. Get Admin API client (Offline / Background)
        logger("Attempting to get Offline Admin API client via unauthenticated.admin...");

        try {
            const { admin: backgroundAdmin } = await shopify.unauthenticated.admin(shop);
            adminClient = backgroundAdmin;
        } catch (error) {
            logger(`Failed to get unauthenticated admin client: ${error}`, true);
            return logs;
        }
    }

    const deactivatedItems = await scanAndDeactivate(adminClient, shop, settings.minDaysInactive);
    // Also run with logger for server logs?
    // For now, the first call logs to console.log as default.

    return deactivatedItems || []; // Return for debug logs if needed, but mainly for type safety

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

    while (hasNextPage) {
        try {
            const response = await client.request(query, { variables: { cursor } });

            // Handle different client response structures
            const responseBody = response.body || response;
            const data = responseBody.data;

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
                        logger(`[Scheduler] MARKING FOR DEACTIVATION: ${product.title} (ID: ${product.id})`);
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
    if (candidates.length > 0) {
        for (const product of candidates) {
            const id = product.id;
            try {
                logger(`[Scheduler] Deactivating ${id}...`);

                // Add tag
                const tagResponse = await client.request(`mutation addTags($id: ID!) { tagsAdd(id: $id, tags: ["auto-archived-oos"]) { userErrors { field message } } }`, { variables: { id } });
                const tagData = tagResponse.body?.data || tagResponse.data;
                if (tagData?.tagsAdd?.userErrors?.length > 0) {
                    logger(`[Scheduler] Error adding tag to ${id}: ${JSON.stringify(tagData.tagsAdd.userErrors)}`, true);
                    // Skip deactivation if tagging fails? Or proceed? Proceeding risks reactivation issues. Skipping is safer.
                    // Actually let's just log and try deactivate.
                }

                // Set Draft
                const updateResponse = await client.request(`mutation setDraft($id: ID!) { productUpdate(input: {id: $id, status: DRAFT}) { userErrors { field message } } }`, { variables: { id } });
                const updateData = updateResponse.body?.data || updateResponse.data;

                if (updateData?.productUpdate?.userErrors?.length > 0) {
                    logger(`[Scheduler] Error setting ${id} to DRAFT: ${JSON.stringify(updateData.productUpdate.userErrors)}`, true);
                } else {
                    const sku = product.variants?.nodes?.[0]?.sku || "";

                    await db.activityLog.create({
                        data: {
                            shop,
                            productId: id,
                            productTitle: product.title, // Use actual product title
                            productSku: sku,
                            method: "AUTO",
                            action: "AUTO-DEACTIVATE"
                        }
                    });
                    logger(`[Scheduler] Successfully deactivated ${id}`);
                    deactivatedItems.push(product);
                }

            } catch (err: any) {
                logger(`[Scheduler] Failed to deactivate ${id}: ${err.message}`, true);
            }
        }
    }

    return deactivatedItems;
}
