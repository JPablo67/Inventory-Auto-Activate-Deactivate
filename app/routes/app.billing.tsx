import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    BlockStack,
    Button,
    Card,
    InlineStack,
    Page,
    Text,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { buildManagedPricingUrl } from "../utils/managed-pricing.server";

interface AppInstallationResponse {
    data?: {
        currentAppInstallation?: {
            activeSubscriptions?: Array<{
                name?: string;
                status?: string;
                test?: boolean;
            }>;
        };
    };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    // currentAppInstallation returns active subscriptions across both test
    // and production billing, so we don't have to know which kind of store
    // the merchant has. The first ACTIVE entry is the merchant's current plan.
    let currentPlan: string | null = null;
    let isTestSubscription = false;
    try {
        const res = await admin.graphql(`{
            currentAppInstallation {
                activeSubscriptions { name status test }
            }
        }`);
        const j = (await res.json()) as AppInstallationResponse;
        const active = (j.data?.currentAppInstallation?.activeSubscriptions ?? []).find(
            (s) => s.status === "ACTIVE"
        );
        if (active) {
            currentPlan = active.name ?? null;
            isTestSubscription = Boolean(active.test);
        }
    } catch {
        // Don't block the page if the query fails — the merchant can still
        // click "Change plan" and Shopify's hosted picker will show them
        // their current plan there.
        currentPlan = null;
    }

    return json({
        currentPlan,
        isTestSubscription,
        managedPricingUrl: buildManagedPricingUrl(session.shop),
    });
};

export default function Billing() {
    const { currentPlan, isTestSubscription, managedPricingUrl } =
        useLoaderData<typeof loader>();

    return (
        <Page title="Plan & Billing">
            <Card>
                <BlockStack gap="400">
                    <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">
                            Current plan
                        </Text>
                        {currentPlan ? (
                            <InlineStack gap="200" blockAlign="center">
                                <Text as="p" variant="bodyLg" fontWeight="semibold">
                                    {currentPlan}
                                </Text>
                                {isTestSubscription && (
                                    <Text as="span" tone="subdued" variant="bodySm">
                                        (test mode)
                                    </Text>
                                )}
                            </InlineStack>
                        ) : (
                            <Text as="p" tone="subdued">
                                We couldn&apos;t load your current plan. Click
                                &ldquo;Change plan&rdquo; below to view it on Shopify.
                            </Text>
                        )}
                    </BlockStack>

                    <Text as="p" tone="subdued">
                        Plans are managed by Shopify. Click below to upgrade, downgrade,
                        or switch between monthly and annual billing.
                    </Text>

                    {/* form + target="_top" breaks out of the embedded iframe so
                        admin.shopify.com loads at the top frame (X-Frame-Options
                        blocks loading it inside our iframe). */}
                    <form method="get" action={managedPricingUrl} target="_top">
                        <Button submit variant="primary">
                            Change plan
                        </Button>
                    </form>
                </BlockStack>
            </Card>
        </Page>
    );
}
