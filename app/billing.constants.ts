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

export const ALL_PLANS = [
    "Starter", "Growth", "Pro",
    "starter", "growth", "pro",
    "shopify-test",
] as const;

export const IS_TEST_BILLING = process.env.NODE_ENV !== "production";
