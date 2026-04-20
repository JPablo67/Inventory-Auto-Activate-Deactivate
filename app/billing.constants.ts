export const STARTER_PLAN = "Starter";
export const GROWTH_PLAN = "Growth";
export const PRO_PLAN = "Pro";
export const STARTER_PLAN_ANNUAL = "Starter Annual";
export const GROWTH_PLAN_ANNUAL = "Growth Annual";
export const PRO_PLAN_ANNUAL = "Pro Annual";

export const ALL_PLANS = [
    STARTER_PLAN,
    GROWTH_PLAN,
    PRO_PLAN,
    STARTER_PLAN_ANNUAL,
    GROWTH_PLAN_ANNUAL,
    PRO_PLAN_ANNUAL,
] as const;

export const IS_TEST_BILLING = process.env.NODE_ENV !== "production";
