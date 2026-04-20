import * as Sentry from "@sentry/remix";
import db from "../db.server";
import { ALL_PLANS, IS_TEST_BILLING } from "../shopify.server";

const GRACE_PERIOD_DAYS = 3;
const GRACE_PERIOD_MS = GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export type SubscriptionStatus = "ACTIVE" | "GRACE" | "NONE";

export function isFreeShop(shop: string): boolean {
    const list = (process.env.FREE_TIER_SHOPS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return list.includes(shop);
}

export type BillingGate =
    | { allowed: true; reason: "free" | "active" | "grace"; gracePeriodEndsAt?: Date | null }
    | { allowed: false; reason: "no-subscription" | "grace-expired" };

// Loose typing to avoid coupling to the full Shopify app config generic.
// The real billing context's `check` accepts a more restrictive plan-name union;
// passing it here is safe at runtime because we only ever call with ALL_PLANS.
type BillingChecker = {
    check: (opts: { plans: readonly string[]; isTest: boolean }) => Promise<{ hasActivePayment: boolean }>;
};

export async function evaluateBilling(
    billing: unknown,
    shop: string,
    now: Date = new Date()
): Promise<BillingGate> {
    const checker = billing as BillingChecker;

    if (isFreeShop(shop)) {
        // Free shops bypass all gating via isFreeShop() in every caller;
        // status/grace fields are not written for them.
        return { allowed: true, reason: "free" };
    }

    let hasActivePayment: boolean;
    try {
        const result = await checker.check({
            plans: ALL_PLANS,
            isTest: IS_TEST_BILLING,
        });
        hasActivePayment = result.hasActivePayment;
    } catch (error) {
        // Shopify's billing endpoint is unreachable. Fail open using the
        // last-known-good state we persisted so paying merchants aren't
        // locked out during a Shopify outage. Worst case: a never-subscribed
        // shop gets temporary access that ends on the next successful check.
        Sentry.withScope((scope) => {
            scope.setTag("shop", shop);
            scope.setContext("billing", { phase: "check", fallback: "persisted-state" });
            Sentry.captureException(error);
        });
        return await fallbackGateFromPersistedState(shop, now);
    }

    if (hasActivePayment) {
        await writeSubscriptionState(shop, "ACTIVE", null);
        return { allowed: true, reason: "active" };
    }

    // No active subscription. Grace period is set only by the
    // app_subscriptions/update webhook on cancellation; if none, this is
    // either a fresh install or a missed-webhook case — send to pricing.
    const settings = await db.settings.findUnique({
        where: { shop },
        select: { gracePeriodEndsAt: true },
    });

    if (!settings?.gracePeriodEndsAt) {
        await writeSubscriptionState(shop, "NONE", null);
        return { allowed: false, reason: "no-subscription" };
    }

    if (now < settings.gracePeriodEndsAt) {
        await writeSubscriptionState(shop, "GRACE", settings.gracePeriodEndsAt);
        return { allowed: true, reason: "grace", gracePeriodEndsAt: settings.gracePeriodEndsAt };
    }

    // Grace window has elapsed — demote to NONE and clear the stale timestamp.
    await writeSubscriptionState(shop, "NONE", null);
    return { allowed: false, reason: "grace-expired" };
}

// Used when Shopify's billing endpoint is unreachable. Reads the last-known-good
// state we wrote on a prior successful check and reconstructs a gate from it.
// Always fails open: the cost of briefly serving a never-subscribed shop
// during an outage is lower than locking out every paying merchant.
async function fallbackGateFromPersistedState(shop: string, now: Date): Promise<BillingGate> {
    const settings = await db.settings.findUnique({
        where: { shop },
        select: { subscriptionStatus: true, gracePeriodEndsAt: true },
    });

    if (
        settings?.subscriptionStatus === "GRACE" &&
        settings.gracePeriodEndsAt &&
        now < settings.gracePeriodEndsAt
    ) {
        return { allowed: true, reason: "grace", gracePeriodEndsAt: settings.gracePeriodEndsAt };
    }

    return { allowed: true, reason: "active" };
}

// Writes status + grace in a single update so the scheduler never observes
// a torn state (e.g. status=ACTIVE with a stale gracePeriodEndsAt).
// updateMany is a no-op when no row exists (uninstalled shops, fresh installs
// before any settings mutation) — that's fine: the scheduler only iterates
// existing rows.
async function writeSubscriptionState(
    shop: string,
    status: SubscriptionStatus,
    gracePeriodEndsAt: Date | null
): Promise<void> {
    await db.settings.updateMany({
        where: { shop },
        data: { subscriptionStatus: status, gracePeriodEndsAt },
    });
}

// Called by the app_subscriptions/update webhook on CANCELLED/EXPIRED/DECLINED/FROZEN.
// Only starts grace when the shop isn't already in GRACE — duplicate webhook
// deliveries don't extend the window, and an ACTIVE→GRACE transition is the
// only path we want to set a fresh timestamp on.
export async function startGracePeriod(shop: string, now: Date = new Date()): Promise<Date | null> {
    const ends = new Date(now.getTime() + GRACE_PERIOD_MS);
    const result = await db.settings.updateMany({
        where: { shop, subscriptionStatus: { not: "GRACE" } },
        data: { subscriptionStatus: "GRACE", gracePeriodEndsAt: ends },
    });
    return result.count > 0 ? ends : null;
}

// Called on ACTIVE webhook: promote to ACTIVE and clear any grace timestamp.
export async function markSubscriptionActive(shop: string): Promise<void> {
    await writeSubscriptionState(shop, "ACTIVE", null);
}

// Used by the unauthenticated scheduler. Free shops always pass; paid shops
// require an explicit ACTIVE status, or GRACE with the clock still inside
// the window (belt-and-suspenders — the loader flips GRACE→NONE on expiry,
// but the scheduler can run between loader visits).
export function isSchedulerAllowed(
    shop: string,
    subscriptionStatus: string,
    gracePeriodEndsAt: Date | null,
    now: Date = new Date()
): boolean {
    if (isFreeShop(shop)) return true;
    if (subscriptionStatus === "ACTIVE") return true;
    if (subscriptionStatus === "GRACE" && gracePeriodEndsAt && now < gracePeriodEndsAt) return true;
    return false;
}
