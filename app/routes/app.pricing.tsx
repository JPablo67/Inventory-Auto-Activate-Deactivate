import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
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
import { STARTER_PLAN, GROWTH_PLAN, PRO_PLAN, ALL_PLANS, IS_TEST_BILLING } from "../billing.constants";
import { isFreeShop } from "../services/billing.server";
import db from "../db.server";

interface PlanInfo {
    id: string;
    name: string;
    price: string;
    productRange: string;
    recommended: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, billing, admin } = await authenticate.admin(request);
    const shop = session.shop;

    if (isFreeShop(shop)) {
        return json({
            isFree: true,
            productCount: 0,
            currentPlan: null as string | null,
            gracePeriodEndsAt: null as string | null,
        });
    }

    const [{ hasActivePayment, appSubscriptions }, settings, productCount] = await Promise.all([
        billing.check({ plans: [...ALL_PLANS], isTest: IS_TEST_BILLING }),
        db.settings.findUnique({ where: { shop }, select: { gracePeriodEndsAt: true } }),
        admin
            .graphql(`{ productsCount { count } }`)
            .then(async (res) => {
                const j = (await res.json()) as { data?: { productsCount?: { count?: number } } };
                return j.data?.productsCount?.count ?? 0;
            })
            .catch(() => 0),
    ]);

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
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { billing } = await authenticate.admin(request);
    const formData = await request.formData();
    const plan = formData.get("plan");

    if (plan !== STARTER_PLAN && plan !== GROWTH_PLAN && plan !== PRO_PLAN) {
        return json({ error: "Invalid plan" }, { status: 400 });
    }

    await billing.request({
        plan,
        isTest: IS_TEST_BILLING,
    });

    return null;
};

export default function PricingPage() {
    const { isFree, productCount, currentPlan, gracePeriodEndsAt } =
        useLoaderData<typeof loader>();

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
        productCount < 500 ? STARTER_PLAN : productCount < 1000 ? GROWTH_PLAN : PRO_PLAN;

    const plans: PlanInfo[] = [
        {
            id: STARTER_PLAN,
            name: "Starter",
            price: "$4.99",
            productRange: "For stores with under 500 products",
            recommended: recommended === STARTER_PLAN,
        },
        {
            id: GROWTH_PLAN,
            name: "Growth",
            price: "$6.99",
            productRange: "For stores with 500–999 products",
            recommended: recommended === GROWTH_PLAN,
        },
        {
            id: PRO_PLAN,
            name: "Pro",
            price: "$9.99",
            productRange: "For stores with 1000+ products",
            recommended: recommended === PRO_PLAN,
        },
    ];

    return (
        <Page title="Choose your plan" subtitle="15-day free trial on every plan. Cancel anytime.">
            <BlockStack gap="400">
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
                <Text as="p" variant="bodyMd">
                    Your store has approximately <b>{productCount.toLocaleString()}</b> products.
                </Text>
                <Layout>
                    {plans.map((plan) => (
                        <Layout.Section variant="oneThird" key={plan.id}>
                            <Card>
                                <BlockStack gap="300">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <Text as="h2" variant="headingLg">
                                            {plan.name}
                                        </Text>
                                        {plan.recommended && (
                                            <Badge tone="success">Recommended</Badge>
                                        )}
                                    </InlineStack>
                                    <Text as="p" variant="heading2xl">
                                        {plan.price}
                                        <Text as="span" variant="bodyMd" tone="subdued">
                                            /month
                                        </Text>
                                    </Text>
                                    <Text as="p" tone="subdued">
                                        {plan.productRange}
                                    </Text>
                                    <Form method="post">
                                        <input type="hidden" name="plan" value={plan.id} />
                                        <Button
                                            submit
                                            variant={plan.recommended ? "primary" : "secondary"}
                                            fullWidth
                                            disabled={currentPlan === plan.id}
                                        >
                                            {currentPlan === plan.id
                                                ? "Current plan"
                                                : "Start 15-day free trial"}
                                        </Button>
                                    </Form>
                                </BlockStack>
                            </Card>
                        </Layout.Section>
                    ))}
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
