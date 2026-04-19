import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import * as Sentry from "@sentry/remix";
import db from "../db.server";
import {
  isDeactivationCandidate,
  type ShopifyGraphQLResponse,
  type ZeroStockProductsData,
  type ZeroStockProductNode,
} from "./inventory-logic";
import { shouldRun, computeNextRunAt } from "./scheduler-logic";
import shopify from "../shopify.server";

function captureShopError(error: unknown, phase: string, shop?: string, extra?: Record<string, unknown>) {
    Sentry.withScope((scope) => {
        if (shop) scope.setTag("shop", shop);
        scope.setContext("scheduler", { phase, ...extra });
        Sentry.captureException(error);
    });
}

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
            // Run Auto-Deactivation Scan
            await runAutoScan();

            // Run Auto-Reactivation Sweeper (Safety Net)
            await runReactivationHelper();
        } catch (error) {
            console.error("[Scheduler] Error in scan loop:", error);
            captureShopError(error, "tick");
        } finally {
            global.__isScanning = false;
            scheduleNextRun();
        }
    }, 15 * 1000); // Poll every 15s. Per-shop cadence is anchored to settings.nextRunAt.
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
                    // Store only the fields needed for display, not full GraphQL objects
                    const slimResults = (deactivatedItems || []).map((p) => ({
                        id: p.id,
                        title: p.title,
                        sku: p.variants?.nodes?.[0]?.sku || "",
                    }));
                    await db.settings.update({
                        where: { shop: settings.shop },
                        data: {
                            lastRunAt: now,
                            nextRunAt: computeNextRunAt(settings.frequency, settings.frequencyUnit, now),
                            lastScanType: 'AUTO',
                            lastScanResults: JSON.stringify(slimResults),
                            currentStatus: "IDLE"
                        }
                    });
                } catch (err) {
                    console.error(`[Scheduler] Error processing ${settings.shop}`, err);
                    captureShopError(err, "auto-scan-shop", settings.shop);
                    // Advance nextRunAt anyway so a persistently failing shop
                    // doesn't get hammered on every 60s poll.
                    await db.settings.update({
                        where: { shop: settings.shop },
                        data: {
                            nextRunAt: computeNextRunAt(settings.frequency, settings.frequencyUnit, now),
                            currentStatus: "IDLE"
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.error("[Scheduler] Error in runAutoScan:", error);
        captureShopError(error, "auto-scan-outer");
    }
}

async function executeScanForShop(shop: string, minDays: number) {
    console.log(`[Scheduler] Executing scan for ${shop}...`);
    try {
        const { admin } = await shopify.unauthenticated.admin(shop);
        return await scanAndDeactivate(admin, shop, minDays);
    } catch (error) {
        console.error(`[Scheduler] Failed to authenticate scanner for ${shop}:`, error);
        captureShopError(error, "scan-auth", shop);
        throw error;
    }
}

async function scanAndDeactivate(client: AdminApiContext, shop: string, minDays: number, logger: Logger = console.log): Promise<ZeroStockProductNode[]> {
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
          variants(first: 100) {
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
    const candidates: ZeroStockProductNode[] = [];
    let productsChecked = 0;

    while (hasNextPage) {
        try {
            const response = await client.graphql(query, { variables: { cursor } });
            const responseJson = (await response.json()) as ShopifyGraphQLResponse<ZeroStockProductsData>;

            const data = responseJson.data;

            if (!data || !data.products) {
                logger(`[Scheduler] No data in response for ${shop}`, true);
                break;
            }

            const { nodes, pageInfo } = data.products;

            for (const product of nodes) {
                productsChecked++;
                const { candidate, daysInactive } = isDeactivationCandidate(product, cutoffMs);
                if (!candidate) continue;

                product.daysInactive = daysInactive;
                candidates.push(product);
            }

            hasNextPage = pageInfo.hasNextPage;
            cursor = pageInfo.endCursor;

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger(`[Scheduler] Error in scan loop for ${shop}: ${message}`, true);
            captureShopError(err, "scan-page", shop, { cursor });
            break;
        }
    }

    logger(`[Scheduler] Scan complete for ${shop}. Checked ${productsChecked} products. Found ${candidates.length} to deactivate.`);

    const deactivatedItems: ZeroStockProductNode[] = [];

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
                        tagsAdd(id: $id, tags: ["auto-changed-draft"]) { userErrors { field message } }
                        productChangeStatus(productId: $id, status: DRAFT) { userErrors { field message } }
                    }`,
                    { variables: { id } }
                );

                interface MutationUserError { field?: string[] | null; message: string }
                interface DeactivateMutationData {
                    tagsAdd?: { userErrors: MutationUserError[] };
                    productChangeStatus?: { userErrors: MutationUserError[] };
                }

                const responseJson = (await response.json()) as ShopifyGraphQLResponse<DeactivateMutationData>;
                const data = responseJson.data;

                const tagErrors = data?.tagsAdd?.userErrors || [];
                const updateErrors = data?.productChangeStatus?.userErrors || [];

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
                            productImageUrl: product.featuredImage?.url || null,
                            method: "AUTO",
                            action: "AUTO-DEACTIVATE"
                        }
                    });
                    deactivatedItems.push(product);
                }

            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger(`[Scheduler] Failed to deactivate ${id}: ${message}`, true);
                captureShopError(err, "deactivate-product", shop, { productId: id });
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
}

// Logic for AUTO-REACTIVATION SWEEPER (Safety Net)
async function runReactivationHelper() {
    console.log(`[Scheduler] Sweeper - Checking for restocked drafts...`);
    try {
        const settingsList = await db.settings.findMany({
            where: { autoReactivate: { equals: true } }
        });

        if (settingsList.length === 0) return;

        for (const settings of settingsList) {
            await executeReactivationScan(settings.shop);
        }

    } catch (error) {
        console.error("[Scheduler] Error in Reactivation Sweeper:", error);
        captureShopError(error, "reactivation-outer");
    }
}

async function executeReactivationScan(shop: string) {
    try {
        const { admin } = await shopify.unauthenticated.admin(shop);

        // Scan for BOTH tags to catch old and new deactivated items
        // Use OR operator to find products with EITHER tag in a single query
        // Syntax: (tag:A OR tag:B) AND status:draft AND inventory_total:>0
        const query = `(tag:auto-changed-draft OR tag:auto-archived-oos) AND status:draft AND inventory_total:>0`;

        await processReactivationQuery(admin, shop, query);

    } catch (error) {
        console.error(`[Scheduler] Failed Reactivation Scan for ${shop}:`, error);
        captureShopError(error, "reactivation-shop", shop);
    }
}

interface RestockedDraftNode {
    id: string;
    title: string;
    tags: string[];
    featuredImage: { url: string } | null;
    variants: { nodes: Array<{ sku?: string | null }> };
}

interface RestockedDraftsData {
    products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RestockedDraftNode[];
    };
}

async function processReactivationQuery(admin: AdminApiContext, shop: string, searchQuery: string) {
    const query = `
        query getRestockedDrafts($cursor: String, $query: String) {
          products(first: 50, query: $query, after: $cursor) {
            pageInfo { hasNextPage, endCursor }
            nodes {
              id
              title
              tags
              featuredImage { url }
              variants(first: 1) { nodes { sku } }
            }
          }
        }
    `;

    let hasNextPage = true;
    let cursor = null;

    // Mutation defined outside loop
    const updateQuery = `
        mutation reactivate($id: ID!, $tags: [String!]!) {
            productChangeStatus(productId: $id, status: ACTIVE) { userErrors { field message } }
            tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
        }
    `;

    while (hasNextPage) {
        const response = await admin.graphql(query, { variables: { cursor, query: searchQuery } });
        const responseJson = (await response.json()) as ShopifyGraphQLResponse<RestockedDraftsData>;

        const data = responseJson.data?.products;
        if (!data) break;

        const { nodes, pageInfo } = data;

        for (const product of nodes) {
            console.log(`[Scheduler] Sweeper found restocked product to Reactivate: ${product.title}`);

            const tagsToRemove = ["auto-changed-draft", "auto-archived-oos"];
            await admin.graphql(updateQuery, { variables: { id: product.id, tags: tagsToRemove } });

            await db.activityLog.create({
                data: {
                    shop,
                    productId: product.id,
                    productTitle: product.title,
                    productSku: product.variants?.nodes?.[0]?.sku || "",
                    productImageUrl: product.featuredImage?.url || null,
                    method: "AUTO-SWEEPER",
                    action: "REACTIVATE"
                }
            });
        }

        hasNextPage = pageInfo.hasNextPage;
        cursor = pageInfo.endCursor;
    }
}
