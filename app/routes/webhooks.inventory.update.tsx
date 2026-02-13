import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

    console.log(`[Webhook] Received ${topic} for shop ${shop}`);

    if (!admin) {
        console.log("[Webhook] No admin context");
        return new Response();
    }

    // Payload for inventory_levels/update:
    // { inventory_item_id: 123, location_id: 456, available: 10, ... }
    const { inventory_item_id, available } = payload as any;

    console.log(`[Webhook] Inventory update: Item ${inventory_item_id}, Available ${available}`);

    if (available && available > 0) {
        // Stock returned! Check if we need to reactivate.
        // We need to find the product associated with this inventory item.
        const query = `
        query findProduct($inventoryItemId: ID!) {
            inventoryItem(id: $inventoryItemId) {
                variant {
                    sku
                    product {
                        id
                        title
                        status
                        tags
                    }
                }
            }
        }
     `;

        // Inventory Item ID in payload is usually just a number, but GraphQL needs GID
        const gid = `gid://shopify/InventoryItem/${inventory_item_id}`;
        console.log(`[Webhook] Querying product for Inventory Item GID: ${gid}`);

        const response = await admin.graphql(query, { variables: { inventoryItemId: gid } });
        const responseJson = await response.json();

        console.log(`[Webhook] GraphQL Response: ${JSON.stringify(responseJson)}`);

        const variant = responseJson.data?.inventoryItem?.variant;
        const product = variant?.product;

        if (product && product.tags && product.tags.includes("auto-archived-oos")) {
            console.log(`[Webhook] MATCH! Reactivating product ${product.title}`);

            // Reactivate
            const updateQuery = `
            mutation reactivate($id: ID!, $tags: [String!]!) {
                productUpdate(input: {id: $id, status: ACTIVE}) {
                    userErrors { field message }
                }
                tagsRemove(id: $id, tags: $tags) {
                    userErrors { field message }
                }
            }
        `;

            const updateRes = await admin.graphql(updateQuery, { variables: { id: product.id, tags: ["auto-archived-oos"] } });
            const updateJson = await updateRes.json();
            console.log(`[Webhook] Update Response: ${JSON.stringify(updateJson)}`);

            // Log
            await db.activityLog.create({
                data: {
                    shop,
                    productId: product.id,
                    productTitle: product.title,
                    productSku: variant.sku,
                    method: "WEBHOOK",
                    action: "REACTIVATE"
                }
            });
        } else {
            console.log(`[Webhook] Product not found or tag missing. Tags: ${product?.tags}`);
        }
    } else {
        console.log("[Webhook] Stock is 0 or undefined, ignoring.");
    }

    return new Response();
};
