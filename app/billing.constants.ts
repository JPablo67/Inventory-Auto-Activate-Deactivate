export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";
export const PRO_PLAN = "Pro";

export const ALL_PLANS = [STARTER_PLAN, GROWTH_PLAN, PRO_PLAN] as const;

export const IS_TEST_BILLING = process.env.NODE_ENV !== "production";

