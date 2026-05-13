import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
    Badge,
    BlockStack,
    Button,
    Card,
    Divider,
    InlineStack,
    Page,
    Text,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { buildManagedPricingUrl } from "../utils/managed-pricing.server";
import {
    PLAN_METADATA,
    type PlanTier,
    tierFromPlanName,
} from "../billing.constants";

interface AppInstallationResponse {
    data?: {
        currentAppInstallation?: {
            activeSubscriptions?: Array<{
                name?: string;
                status?: string;
                test?: boolean;
                lineItems?: Array<{
                    plan?: {
                        pricingDetails?: {
                            __typename?: string;
                            interval?: string;
                        };
                    };
                }>;
            }>;
        };
    };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    // We fetch lineItems.plan.pricingDetails so we can detect monthly vs annual
    // and switch the upsell copy. The activeSubscriptions field already filters
    // by ACTIVE status, so the first entry is the merchant's current plan.
    let currentPlan: string | null = null;
    let isTestSubscription = false;
    let isAnnual = false;
    try {
        const res = await admin.graphql(`{
            currentAppInstallation {
                activeSubscriptions {
                    name
                    status
                    test
                    lineItems {
                        plan {
                            pricingDetails {
                                __typename
                                ... on AppRecurringPricing { interval }
                            }
                        }
                    }
                }
            }
        }`);
        const j = (await res.json()) as AppInstallationResponse;
        const active = (j.data?.currentAppInstallation?.activeSubscriptions ?? []).find(
            (s) => s.status === "ACTIVE"
        );
        if (active) {
            currentPlan = active.name ?? null;
            isTestSubscription = Boolean(active.test);
            isAnnual = active.lineItems?.[0]?.plan?.pricingDetails?.interval === "ANNUAL";
        }
    } catch {
        // Fail soft — the page still works without subscription metadata, and
        // the "Change plan" button still escapes to Shopify's hosted picker.
        currentPlan = null;
    }

    return json({
        currentPlan,
        isTestSubscription,
        isAnnual,
        currentTier: tierFromPlanName(currentPlan),
        managedPricingUrl: buildManagedPricingUrl(session.shop),
    });
};

function ManagedPricingButton({
    url,
    children,
    variant,
}: {
    url: string;
    children: string;
    variant?: "primary" | "secondary";
}) {
    // target="_top" breaks out of the embedded iframe so admin.shopify.com
    // loads at the top frame (X-Frame-Options blocks loading inside iframe).
    return (
        <form method="get" action={url} target="_top">
            <Button submit variant={variant}>
                {children}
            </Button>
        </form>
    );
}

function SavingsChip({ label, amount }: { label: string; amount: number }) {
    return (
        <InlineStack gap="100" blockAlign="center">
            <Text as="span" variant="bodySm" fontWeight="semibold">
                {label}
            </Text>
            <Text as="span" variant="bodySm" tone="success" fontWeight="semibold">
                ${amount} off
            </Text>
        </InlineStack>
    );
}

function UpgradeTeaser({
    tier,
    managedPricingUrl,
}: {
    tier: PlanTier;
    managedPricingUrl: string;
}) {
    if (tier === "pro") {
        // No upsell — they're already on the top tier. Just acknowledge it.
        return (
            <Card>
                <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                        🚀 You&apos;re on our top plan
                    </Text>
                    <Text as="p" tone="subdued">
                        Thanks for being a power user. You&apos;re getting unlimited
                        inventory coverage at our best price.
                    </Text>
                </BlockStack>
            </Card>
        );
    }

    const heading =
        tier === "starter"
            ? "📈 Outgrowing Starter?"
            : "📈 Scaling beyond 1,000 products?";
    const body =
        tier === "starter"
            ? `More than 500 products in your catalog? Growth covers 500–999 ($${PLAN_METADATA.growth.monthly}/mo). Pro is unlimited ($${PLAN_METADATA.pro.monthly}/mo).`
            : `Pro keeps you covered with unlimited inventory at $${PLAN_METADATA.pro.monthly}/mo — same features, no product cap.`;

    return (
        <Card>
            <BlockStack gap="400">
                <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                        {heading}
                    </Text>
                    <Text as="p" tone="subdued">
                        {body}
                    </Text>
                </BlockStack>
                <ManagedPricingButton url={managedPricingUrl}>
                    Compare plans
                </ManagedPricingButton>
            </BlockStack>
        </Card>
    );
}

export default function Billing() {
    const {
        currentPlan,
        isTestSubscription,
        isAnnual,
        currentTier,
        managedPricingUrl,
    } = useLoaderData<typeof loader>();

    const tierMeta = currentTier ? PLAN_METADATA[currentTier] : null;
    // Don't market to reviewers — shopify-test is a $0 review plan and the
    // savings/upgrade pitches don't apply to it. Annual users see a confirmation
    // chip instead of the upsell card.
    const showAnnualUpsell = Boolean(tierMeta) && !isAnnual && !isTestSubscription;
    const showUpgradeTeaser = Boolean(tierMeta) && !isTestSubscription;

    return (
        <Page title="Plan & Billing">
            <BlockStack gap="500">
                {/* ── Current plan ───────────────────────────────────── */}
                <Card>
                    <BlockStack gap="400">
                        <Text as="h2" variant="headingMd">
                            Current plan
                        </Text>
                        {currentPlan && tierMeta ? (
                            <BlockStack gap="200">
                                <InlineStack gap="200" blockAlign="center">
                                    <Text as="p" variant="bodyLg" fontWeight="semibold">
                                        {tierMeta.displayName}
                                    </Text>
                                    {isTestSubscription && (
                                        <Badge tone="info">Test mode</Badge>
                                    )}
                                    {isAnnual && <Badge tone="success">Annual</Badge>}
                                </InlineStack>
                                <Text as="p" tone="subdued">
                                    {tierMeta.productRange} ·{" "}
                                    {isAnnual
                                        ? `$${tierMeta.annual}/year`
                                        : `$${tierMeta.monthly}/month`}
                                </Text>
                            </BlockStack>
                        ) : currentPlan ? (
                            // Plan we don't recognize (mis-mapped name in
                            // billing.constants.ts). Show the raw name so the
                            // merchant isn't confused, and skip metadata.
                            <InlineStack gap="200" blockAlign="center">
                                <Text as="p" variant="bodyLg" fontWeight="semibold">
                                    {currentPlan}
                                </Text>
                                {isTestSubscription && (
                                    <Badge tone="info">Test mode</Badge>
                                )}
                            </InlineStack>
                        ) : (
                            <Text as="p" tone="subdued">
                                We couldn&apos;t load your current plan. Click
                                &ldquo;Change plan&rdquo; below to view it on Shopify.
                            </Text>
                        )}

                        <Divider />

                        <Text as="p" tone="subdued">
                            Plans are managed by Shopify. Use the button below to
                            upgrade, downgrade, or switch between monthly and annual
                            billing.
                        </Text>

                        <ManagedPricingButton url={managedPricingUrl} variant="primary">
                            Change plan
                        </ManagedPricingButton>
                    </BlockStack>
                </Card>

                {/* ── Annual savings upsell ─────────────────────────── */}
                {showAnnualUpsell && (
                    <Card>
                        <BlockStack gap="400">
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">
                                    💡 Save up to 28% with annual billing
                                </Text>
                                <Text as="p" tone="subdued">
                                    Pay yearly and get nearly two months free. Same
                                    features and support, just one bill.
                                </Text>
                            </BlockStack>
                            <InlineStack gap="400" wrap>
                                <SavingsChip
                                    label={PLAN_METADATA.starter.displayName}
                                    amount={PLAN_METADATA.starter.annualSavings}
                                />
                                <SavingsChip
                                    label={PLAN_METADATA.growth.displayName}
                                    amount={PLAN_METADATA.growth.annualSavings}
                                />
                                <SavingsChip
                                    label={PLAN_METADATA.pro.displayName}
                                    amount={PLAN_METADATA.pro.annualSavings}
                                />
                            </InlineStack>
                            <ManagedPricingButton url={managedPricingUrl} variant="primary">
                                View annual plans
                            </ManagedPricingButton>
                        </BlockStack>
                    </Card>
                )}

                {/* ── Upgrade-path teaser ───────────────────────────── */}
                {showUpgradeTeaser && currentTier && (
                    <UpgradeTeaser
                        tier={currentTier}
                        managedPricingUrl={managedPricingUrl}
                    />
                )}
            </BlockStack>
        </Page>
    );
}
