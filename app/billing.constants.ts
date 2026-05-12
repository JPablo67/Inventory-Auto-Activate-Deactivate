// Plan names MUST match what's configured in Partner Dashboard → Apps →
// Auto Hide Out of Stock → Pricing. billing.check() does case-sensitive
// matching, so a typo here silently breaks the gate (every shop is gated
// as if it had no subscription).
//
// Each public plan bundles both a monthly and an annual price — the plan
// name is the same regardless of which interval the merchant chose.
// shopify-test is a private $0 plan used for App Store review and dev
// testing; including it in ALL_PLANS lets reviewer subscriptions pass.
export const STARTER_PLAN = "starter";
export const GROWTH_PLAN = "growth";
export const PRO_PLAN = "pro";
export const TEST_PLAN = "shopify-test";

export const ALL_PLANS = [STARTER_PLAN, GROWTH_PLAN, PRO_PLAN, TEST_PLAN] as const;

export const IS_TEST_BILLING = process.env.NODE_ENV !== "production";
