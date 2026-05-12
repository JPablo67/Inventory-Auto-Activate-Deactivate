import type { ActionFunctionArgs } from "@remix-run/node";
import * as Sentry from "@sentry/remix";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface InventoryLevelPayload {
    inventory_item_id?: number;
    available?: number;
}

interface ProductLookupResult {
    data?: {
        inventoryItem?: {
            variant?: {
                sku?: string | null;
                product?: {
                    id: string;
                    title: string;
                    status: string;
                    tags?: string[];
                    featuredImage?: { url?: string | null } | null;
                } | null;
            } | null;
        } | null;
    };
}

export const action = async ({ request }: ActionFunctionArgs) => {
    const webhookId = request.headers.get("x-shopify-webhook-id");

    try {
        const { topic, shop, admin, payload } = await authenticate.webhook(request);

        Sentry.getCurrentScope().setTag("shop", shop);
        Sentry.getCurrentScope().setTag("webhook_topic", topic);
        if (webhookId) Sentry.getCurrentScope().setTag("webhook_id", webhookId);

        if (!admin) {
            return new Response("OK", { status: 200 });
        }

        const { inventory_item_id, available } = (payload ?? {}) as InventoryLevelPayload;

        if (!available || available <= 0 || !inventory_item_id) {
            return new Response("OK", { status: 200 });
        }

        const settings = await db.settings.findUnique({ where: { shop } });
        if (!settings?.autoReactivate) {
            return new Response("OK", { status: 200 });
        }

        const gid = `gid://shopify/InventoryItem/${inventory_item_id}`;
        const lookupRes = await admin.graphql(
            `query findProduct($inventoryItemId: ID!) {
                inventoryItem(id: $inventoryItemId) {
                    variant {
                        sku
                        product {
                            id
                            title
                            status
                            tags
                            featuredImage { url }
                        }
                    }
                }
            }`,
            { variables: { inventoryItemId: gid } }
        );
        const lookupJson = (await lookupRes.json()) as ProductLookupResult;

        const variant = lookupJson.data?.inventoryItem?.variant;
        const product = variant?.product;
        if (!product) {
            return new Response("OK", { status: 200 });
        }

        const tags = product.tags ?? [];
        const hasReactivationTag =
            tags.includes("auto-changed-draft") || tags.includes("auto-archived-oos");
        if (!hasReactivationTag) {
            return new Response("OK", { status: 200 });
        }

        await admin.graphql(
            `mutation reactivate($id: ID!, $tags: [String!]!) {
                productChangeStatus(productId: $id, status: ACTIVE) {
                    userErrors { field message }
                }
                tagsRemove(id: $id, tags: $tags) {
                    userErrors { field message }
                }
            }`,
            {
                variables: {
                    id: product.id,
                    tags: ["auto-changed-draft", "auto-archived-oos"],
                },
            }
        );

        // Idempotent log: webhookId is unique, so a retried delivery is a no-op.
        // Falls back to plain create when the header is missing (won't happen in prod).
        if (webhookId) {
            await db.activityLog
                .create({
                    data: {
                        shop,
                        productId: product.id,
                        productTitle: product.title,
                        productSku: variant.sku ?? null,
                        productImageUrl: product.featuredImage?.url ?? null,
                        method: "WEBHOOK",
                        action: "REACTIVATE",
                        webhookId,
                    },
                })
                .catch((err: unknown) => {
                    // P2002 = unique constraint violation, expected on retries; swallow.
                    const code = (err as { code?: string })?.code;
                    if (code !== "P2002") throw err;
                });
        } else {
            await db.activityLog.create({
                data: {
                    shop,
                    productId: product.id,
                    productTitle: product.title,
                    productSku: variant.sku ?? null,
                    productImageUrl: product.featuredImage?.url ?? null,
                    method: "WEBHOOK",
                    action: "REACTIVATE",
                },
            });
        }

        return new Response("OK", { status: 200 });
    } catch (error) {
        // Never let Shopify see a 5xx: it retries aggressively and amplifies any bug.
        // HMAC failures are thrown as Response objects by authenticate.webhook; let those surface.
        if (error instanceof Response) throw error;
        Sentry.captureException(error, { tags: { webhook_id: webhookId ?? "unknown" } });
        return new Response("OK", { status: 200 });
    }
};
