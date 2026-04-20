import { useState } from "react";
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import * as Sentry from "@sentry/remix";
import {
    Page,
    Layout,
    Card,
    Button,
    Text,
    BlockStack,
    InlineStack,
    Banner,
    Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import {
    STARTER_PLAN, GROWTH_PLAN, PRO_PLAN,
    STARTER_PLAN_ANNUAL, GROWTH_PLAN_ANNUAL, PRO_PLAN_ANNUAL,
    ALL_PLANS, IS_TEST_BILLING,
} from "../billing.constants";
import { isFreeShop } from "../services/billing.server";
import db from "../db.server";

const PLAN_DATA = [
    {
        baseName: "Starter",
        monthlyId: STARTER_PLAN,
        annualId: STARTER_PLAN_ANNUAL,
        monthlyPrice: "$4.99",
        annualPrice: "$44.99",
        annualSavings: "Save $14.89 vs. monthly",
        productRange: "For stores with under 500 products",
    },
    {
        baseName: "Growth",
        monthlyId: GROWTH_PLAN,
        annualId: GROWTH_PLAN_ANNUAL,
        monthlyPrice: "$6.99",
        annualPrice: "$59.99",
        annualSavings: "Save $23.89 vs. monthly",
        productRange: "For stores with 500–999 products",
    },
    {
        baseName: "Pro",
        monthlyId: PRO_PLAN,
        annualId: PRO_PLAN_ANNUAL,
        monthlyPrice: "$9.99",
        annualPrice: "$89.99",
        annualSavings: "Save $29.89 vs. monthly",
        productRange: "For stores with 1,000+ products",
    },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, billing, admin } = await authenticate.admin(request);
    const shop = session.shop;

    if (isFreeShop(shop)) {
        return json({
            isFree: true,
            productCount: 0,
            currentPlan: null as string | null,
            gracePeriodEndsAt: null as string | null,
            billingUnavailable: false,
        });
    }

    const [billingResult, settings, productCount] = await Promise.all([
        billing
            .check({ plans: [...ALL_PLANS], isTest: IS_TEST_BILLING })
            .then((r) => ({ ok: true as const, ...r }))
            .catch((error) => {
                Sentry.withScope((scope) => {
                    scope.setTag("shop", shop);
                    scope.setContext("billing", { phase: "pricing-page-check" });
                    Sentry.captureException(error);
                });
                return { ok: false as const, hasActivePayment: false, appSubscriptions: [] };
            }),
        db.settings.findUnique({ where: { shop }, select: { gracePeriodEndsAt: true } }),
        admin
            .graphql(`{ productsCount { count } }`)
            .then(async (res) => {
                const j = (await res.json()) as { data?: { productsCount?: { count?: number } } };
                return j.data?.productsCount?.count ?? 0;
            })
            .catch(() => 0),
    ]);

    const { ok: billingOk, hasActivePayment, appSubscriptions } = billingResult;
    const currentPlan = hasActivePayment ? appSubscriptions?.[0]?.name ?? null : null;
    const now = new Date();
    const graceEnds = settings?.gracePeriodEndsAt ?? null;
    const gracePeriodEndsAt =
        !hasActivePayment && graceEnds && now < graceEnds ? graceEnds.toISOString() : null;

    return json({
        isFree: false,
        productCount,
        currentPlan,
        gracePeriodEndsAt,
        billingUnavailable: !billingOk,
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { billing } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get("plan") as string;

    if (!(ALL_PLANS as readonly string[]).includes(plan)) {
        return json({ error: "Invalid plan" }, { status: 400 });
    }

    await billing.request({
        plan: plan as typeof ALL_PLANS[number],
        isTest: IS_TEST_BILLING,
    });

    return null;
};

export default function PricingPage() {
    const { isFree, productCount, currentPlan, gracePeriodEndsAt, billingUnavailable } =
        useLoaderData<typeof loader>();

    const [interval, setInterval] = useState<"monthly" | "annual">(
        currentPlan?.includes("Annual") ? "annual" : "monthly"
    );

    if (isFree) {
        return (
            <Page title="Pricing">
                <Banner tone="success" title="Internal store — billing waived">
                    <p>
                        Your store is on the internal free plan. No subscription required.
                    </p>
                </Banner>
            </Page>
        );
    }

    const recommended =
        productCount < 500 ? "Starter" : productCount < 1000 ? "Growth" : "Pro";

    return (
        <Page title="Choose your plan" subtitle="15-day free trial on every plan. Cancel anytime.">
            <BlockStack gap="400">
                {billingUnavailable && (
                    <Banner tone="warning" title="Billing service temporarily unavailable">
                        <p>
                            We couldn&apos;t reach Shopify&apos;s billing service. Your current
                            subscription is not shown below, and starting a new plan may fail
                            until the service recovers. Please try again in a few minutes.
                        </p>
                    </Banner>
                )}
                {gracePeriodEndsAt && (
                    <Banner tone="warning" title="Subscription grace period">
                        <p>
                            Your subscription has lapsed. You have until{" "}
                            {new Date(gracePeriodEndsAt).toLocaleString()} to choose a plan
                            before access is suspended.
                        </p>
                    </Banner>
                )}
                {currentPlan && (
                    <Banner tone="info" title={`You're currently on the ${currentPlan} plan`}>
                        <p>Pick a different plan below to switch.</p>
                    </Banner>
                )}

                <InlineStack align="center" gap="200">
                    <Button
                        pressed={interval === "monthly"}
                        variant={interval === "monthly" ? "primary" : "secondary"}
                        onClick={() => setInterval("monthly")}
                    >
                        Monthly
                    </Button>
                    <Button
                        pressed={interval === "annual"}
                        variant={interval === "annual" ? "primary" : "secondary"}
                        onClick={() => setInterval("annual")}
                    >
                        Annual · Save up to 28%
                    </Button>
                </InlineStack>

                <Text as="p" variant="bodyMd">
                    Your store has approximately <b>{productCount.toLocaleString()}</b> products.
                </Text>

                <Layout>
                    {PLAN_DATA.map((plan) => {
                        const planId = interval === "annual" ? plan.annualId : plan.monthlyId;
                        const isCurrentPlan = currentPlan === planId;
                        const isRecommended = plan.baseName === recommended;

                        return (
                            <Layout.Section variant="oneThird" key={plan.baseName}>
                                <Card>
                                    <BlockStack gap="300">
                                        <InlineStack align="space-between" blockAlign="center">
                                            <Text as="h2" variant="headingLg">
                                                {plan.baseName}
                                            </Text>
                                            {isRecommended && (
                                                <Badge tone="success">Recommended</Badge>
                                            )}
                                        </InlineStack>
                                        <Text as="p" variant="heading2xl">
                                            {interval === "annual" ? plan.annualPrice : plan.monthlyPrice}
                                            <Text as="span" variant="bodyMd" tone="subdued">
                                                {interval === "annual" ? "/year" : "/month"}
                                            </Text>
                                        </Text>
                                        {interval === "annual" && (
                                            <Text as="p" variant="bodySm" tone="success">
                                                {plan.annualSavings}
                                            </Text>
                                        )}
                                        <Text as="p" tone="subdued">
                                            {plan.productRange}
                                        </Text>
                                        <Form method="post">
                                            <input type="hidden" name="plan" value={planId} />
                                            <Button
                                                submit
                                                variant={isRecommended ? "primary" : "secondary"}
                                                fullWidth
                                                disabled={isCurrentPlan}
                                            >
                                                {isCurrentPlan
                                                    ? "Current plan"
                                                    : "Start 15-day free trial"}
                                            </Button>
                                        </Form>
                                    </BlockStack>
                                </Card>
                            </Layout.Section>
                        );
                    })}
                </Layout>

                {IS_TEST_BILLING && (
                    <Banner tone="info">
                        <p>
                            <b>Dev mode:</b> billing is in test mode. Card will not be charged.
                        </p>
                    </Banner>
                )}
            </BlockStack>
        </Page>
    );
}
