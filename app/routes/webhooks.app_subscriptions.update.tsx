import type { ActionFunctionArgs } from "@remix-run/node";
import * as Sentry from "@sentry/remix";
import { authenticate } from "../shopify.server";
import {
    startGracePeriod,
    markSubscriptionActive,
    hasAnyActiveSubscription,
    invalidateBillingGate,
} from "../services/billing.server";

interface SubscriptionPayload {
    app_subscription?: {
        admin_graphql_api_id?: string;
        name?: string;
        status?: string;
    };
}

// Statuses that *might* trigger a grace period (merchant lost active billing).
// We don't unconditionally transition to GRACE on these — see the handler
// below for the plan-switch guard.
const LAPSED_STATUSES = new Set(["CANCELLED", "EXPIRED", "DECLINED", "FROZEN"]);

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, payload, admin } = await authenticate.webhook(request);

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
        return new Response("OK", { status: 200 });
    }

    if (!LAPSED_STATUSES.has(status)) {
        // PENDING / ACCEPTED transitions are intermediate; ignore.
        return new Response("OK", { status: 200 });
    }

    // ── LAPSED path ─────────────────────────────────────────────────────
    // A CANCELLED webhook can mean two very different things:
    //   1. The merchant truly lost billing (cancelled, payment declined, etc.)
    //   2. The merchant switched plans — Shopify cancels the old subscription
    //      and creates a new ACTIVE one. The CANCELLED webhook for the old
    //      sub still fires.
    // Naively starting a grace period on every CANCELLED would dump every
    // plan-switching merchant into GRACE. Before transitioning, check whether
    // the merchant still has *any* active subscription on Shopify's side.

    if (!admin) {
        // No offline session available — we can't ask Shopify. Fail SAFE:
        // don't transition to GRACE. evaluateBilling on the next page load
        // is the authoritative gate and will lock the merchant out if there
        // truly is no subscription. Better to leave the user with a minute
        // of over-access than to trap a legitimate switcher in phantom GRACE.
        Sentry.captureMessage("LAPSED webhook arrived without admin context", {
            level: "warning",
            tags: { status },
        });
        invalidateBillingGate(shop);
        return new Response("OK", { status: 200 });
    }

    let stillActive: boolean;
    try {
        stillActive = await hasAnyActiveSubscription(admin);
    } catch (error) {
        // Same reasoning as the no-admin path: fail safe rather than risk a
        // false-positive grace transition. The next evaluateBilling will
        // reach Shopify directly and gate correctly if needed.
        Sentry.captureException(error, { tags: { status, phase: "active-sub-check" } });
        invalidateBillingGate(shop);
        return new Response("OK", { status: 200 });
    }

    if (stillActive) {
        console.log(
            `[Webhook] ${topic} for ${shop} (status ${status}) but another subscription is ACTIVE — plan switch. No grace transition.`
        );
        // The DB may still carry stale state from a prior cancellation; the
        // cache definitely does. Invalidate so the next evaluateBilling
        // recomputes from Shopify (which will see ACTIVE and write ACTIVE).
        invalidateBillingGate(shop);
        return new Response("OK", { status: 200 });
    }

    const ends = await startGracePeriod(shop);
    if (ends) {
        console.log(`[Webhook] Started grace period for ${shop}, ends ${ends.toISOString()}.`);
    } else {
        // Either no settings row (uninstalled or never configured) or grace
        // was already set by a duplicate webhook delivery — both are no-ops.
        console.log(`[Webhook] No-op for ${shop} (no settings row, or grace already set).`);
    }

    return new Response("OK", { status: 200 });
};
