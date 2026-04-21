import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    try {
        const { topic, shop, payload } = await authenticate.webhook(request);

        // These webhooks are mandatory for the App Store.
        // Since we do not store customer PII (Personally Identifiable Information) in our database,
        // we just acknowledge the request.

        switch (topic) {
            case "CUSTOMERS_DATA_REQUEST":
            case "CUSTOMERS_REDACT":
            case "SHOP_REDACT":
            default:
                console.log(`[Privacy Webhook] Received ${topic} for shop ${shop}`);
                // If we did store data, we would process 'payload' here.
                break;
        }

        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("[Privacy Webhook] Verification failed", {
            method: request.method,
            url: request.url,
            topic: request.headers.get("x-shopify-topic"),
            shop: request.headers.get("x-shopify-shop-domain"),
            webhookId: request.headers.get("x-shopify-webhook-id"),
            hasHmac: Boolean(request.headers.get("x-shopify-hmac-sha256")),
            userAgent: request.headers.get("user-agent"),
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};
