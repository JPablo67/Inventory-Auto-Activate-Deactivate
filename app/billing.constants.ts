// Plan names MUST match what Shopify stores in AppSubscription.name when a
// merchant subscribes. billing.check() does case-sensitive matching, so a
// typo here silently breaks the gate (every shop gated as if no plan).
//
// Partner Dashboard → Pricing displays the lowercase plan handle
// (starter/growth/pro), but Shopify stores the capitalized DISPLAY name
// (Starter/Growth/Pro) on the actual subscription. We include both casings
// here to stay correct regardless of which form Shopify settles on.
//
// Each public plan bundles both monthly and annual pricing under one name —
// the subscription name is the same regardless of which interval the
// merchant chose. shopify-test is a private $0 plan for App Store review.
export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";
export const PRO_PLAN = "Pro";
export const TEST_PLAN = "shopify-test";

// Subscription names billing.check matches against. The Pro tier is named
// "1,000+ products" in Partner Dashboard (Shopify Managed Pricing surface),
// so the literal string here has to match exactly. If you rename a plan in
// the dashboard you MUST add the new name here, otherwise paying merchants
// will fail the gate.
export const ALL_PLANS = [
    "Starter", "Growth", "Pro",
    "starter", "growth", "pro",
    "1,000+ products", "1000+ products",
    "shopify-test",
] as const;

export const IS_TEST_BILLING = process.env.NODE_ENV !== "production";

// Marketing-copy metadata keyed by internal tier. Pricing/copy here is the
// source of truth for in-app upsell surfaces (Plan & Billing page). Partner
// Dashboard remains the authoritative billing source — keep these aligned.
export type PlanTier = "starter" | "growth" | "pro";

export interface PlanMetadata {
    tier: PlanTier;
    displayName: string;
    monthly: number;
    annual: number;
    annualSavings: number;
    productRange: string;
}

export const PLAN_METADATA: Record<PlanTier, PlanMetadata> = {
    starter: {
        tier: "starter",
        displayName: "Starter",
        monthly: 4.99,
        annual: 44.99,
        annualSavings: 14,
        productRange: "Up to 500 products",
    },
    growth: {
        tier: "growth",
        displayName: "Growth",
        monthly: 6.99,
        annual: 59.99,
        annualSavings: 23,
        productRange: "500–999 products",
    },
    pro: {
        tier: "pro",
        displayName: "Pro",
        monthly: 9.99,
        annual: 89.99,
        annualSavings: 29,
        productRange: "1,000+ products",
    },
};

// Maps every accepted subscription name (whatever Shopify happens to return)
// to a tier. Add new variants here when Partner Dashboard renames a plan.
const PLAN_NAME_TO_TIER: Record<string, PlanTier> = {
    Starter: "starter",
    starter: "starter",
    Growth: "growth",
    growth: "growth",
    Pro: "pro",
    pro: "pro",
    "1,000+ products": "pro",
    "1000+ products": "pro",
};

export function tierFromPlanName(name: string | null | undefined): PlanTier | null {
    if (!name) return null;
    return PLAN_NAME_TO_TIER[name] ?? null;
}
