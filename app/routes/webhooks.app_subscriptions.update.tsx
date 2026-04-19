import type { ActionFunctionArgs } from "@remix-run/node";
import * as Sentry from "@sentry/remix";
import { authenticate } from "../shopify.server";
import { startGracePeriod, markSubscriptionActive } from "../services/billing.server";

interface SubscriptionPayload {
    app_subscription?: {
        admin_graphql_api_id?: string;
        name?: string;
        status?: string;
    };
}

// Statuses that should trigger a grace period (merchant lost active billing).
// "FROZEN" is rare but counts (Shopify froze the subscription due to billing issues).
const LAPSED_STATUSES = new Set(["CANCELLED", "EXPIRED", "DECLINED", "FROZEN"]);

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    Sentry.getCurrentScope().setTag("shop", shop);
    Sentry.getCurrentScope().setTag("webhook_topic", topic);

    const sub = (payload as SubscriptionPayload).app_subscription;
    const status = sub?.status?.toUpperCase();

    console.log(`[Webhook] ${topic} for ${shop} - subscription "${sub?.name}" status: ${status}`);

    if (!status) {
        return new Response("OK", { status: 200 });
    }

    if (status === "ACTIVE") {
        await markSubscriptionActive(shop);
        console.log(`[Webhook] Marked ${shop} subscription active.`);
    } else if (LAPSED_STATUSES.has(status)) {
        const ends = await startGracePeriod(shop);
        if (ends) {
            console.log(`[Webhook] Started grace period for ${shop}, ends ${ends.toISOString()}.`);
        } else {
            console.log(`[Webhook] No-op for ${shop} (no settings row, or grace already set).`);
        }
    }
    // PENDING / ACCEPTED transitions are intermediate; ignore.

    return new Response("OK", { status: 200 });
};
