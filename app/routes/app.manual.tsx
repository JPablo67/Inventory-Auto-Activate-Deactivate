import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation, Link as RemixLink } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
    Page,
    Layout,
    Text,
    Card,
    Button,
    BlockStack,
    Box,
    InlineStack,
    Banner,
    IndexTable,
    Badge,
    useIndexResourceState,
    Thumbnail,
    TextField,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { scanOldProducts, deactivateProducts } from "../services/inventory.server";
import db from "../db.server";

// Define Settings Interface
interface Settings {
    isActive: boolean;
    frequency: number;
    frequencyUnit: string;
    lastRunAt: string | null;
    minDaysInactive: number;
    lastScanType?: string;
    lastScanResults?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);

    // 1. Fetch Settings
    const settings = await db.settings.findUnique({ where: { shop: session.shop } });

    // 2. Fetch Activity Log
    const logs = await db.activityLog.findMany({
        where: { shop: session.shop },
        take: 20, // Fetch more for the dedicated manual page? Or keep 10? User said "same data". Let's keep 20 to be safe/better.
        orderBy: { createdAt: "desc" },
    });

    // Enrich logs with Shopify Product Data (Image, SKU, Current Status)
    const logProductIds = [...new Set(logs.map((l) => l.productId).filter((id) => id))];
    const logProductsMap: Record<string, any> = {};

    if (logProductIds.length > 0) {
        const query = `
      query getLogProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            status
            featuredImage { url }
            variants(first: 1) { nodes { sku } }
          }
        }
      }
    `;

        try {
            const response = await admin.graphql(query, { variables: { ids: logProductIds } });
            const responseJson = await response.json();
            const nodes = (responseJson as any).data?.nodes || [];

            nodes.forEach((node: any) => {
                if (node && node.id) {
                    logProductsMap[node.id] = node;
                }
            });
        } catch (e) {
            console.error("Failed to fetch details for log products:", e);
        }
    }

    const enrichedLogs = logs.map((log) => ({
        ...log,
        productDetails: logProductsMap[log.productId] || null,
    }));

    return json({ settings, logs: enrichedLogs });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session: settingsSession } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "scan") {
        const days = parseInt(formData.get("days") as string || "90", 10);
        const candidates = await scanOldProducts(request, days);

        // Update Last Scan info
        await db.settings.upsert({
            where: { shop: settingsSession.shop },
            update: {
                lastRunAt: new Date(),
                lastScanType: 'MANUAL',
                lastScanResults: JSON.stringify(candidates)
            },
            create: {
                shop: settingsSession.shop,
                isActive: false,
                lastRunAt: new Date(),
                lastScanType: 'MANUAL',
                lastScanResults: JSON.stringify(candidates)
            }
        });

        return json({ candidates, success: true });
    }

    if (actionType === "deactivate") {
        const productsString = formData.get("selectedProducts") as string;
        const products = JSON.parse(productsString || "[]");

        // Extract IDs for the service call
        const ids = products.map((p: any) => p.id);

        if (ids.length > 0) {
            await deactivateProducts(request, ids);

            const shop = settingsSession.shop;
            for (const product of products) {
                await db.activityLog.create({
                    data: {
                        shop,
                        productId: product.id,
                        productTitle: product.title,
                        productSku: product.sku,
                        method: "MANUAL",
                        action: "DEACTIVATE",
                    }
                });
            }
        }

        return json({ success: true, deactivatedCount: ids.length, ids });
    }

    if (actionType === "clearLogs") {
        await db.activityLog.deleteMany({
            where: { shop: settingsSession.shop }
        });
        return json({ success: true, clearedLogs: true });
    }

    return null;
};

export default function ManualScanPage() {
    const { settings, logs } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const shopify = useAppBridge();

    const isLoading = navigation.state === "submitting" || navigation.state === "loading";
    const isScanning = isLoading && navigation.formData?.get("actionType") === "scan";
    const isDeactivating = isLoading && navigation.formData?.get("actionType") === "deactivate";

    const typedSettings = settings as Settings | null;

    // Resolve items to display
    const persistentResults = typedSettings?.lastScanResults ? JSON.parse(typedSettings.lastScanResults) : [];
    const persistentType = typedSettings?.lastScanType;

    const activeCandidates = (actionData as any)?.candidates || [];
    const hasActiveCandidates = activeCandidates.length > 0;
    const visibleItems = hasActiveCandidates ? activeCandidates : persistentResults;

    const isManualMode = hasActiveCandidates || (visibleItems.length > 0 && persistentType === 'MANUAL');
    const isReadonly = !isManualMode && visibleItems.length > 0 && persistentType === 'AUTO';

    const {
        selectedResources: selectedCandidates,
        allResourcesSelected: allCandidatesSelected,
        handleSelectionChange: handleCandidateSelection,
        clearSelection: clearCandidateSelection
    } = useIndexResourceState(visibleItems);

    const [daysThreshold, setDaysThreshold] = useState("90");

    useEffect(() => {
        if ((actionData as any)?.deactivatedCount) {
            shopify.toast.show(`${(actionData as any).deactivatedCount} products changed to Draft`);
            clearCandidateSelection();
        }
    }, [actionData, shopify]);

    const handleScan = () => {
        submit({ actionType: "scan", days: daysThreshold }, { method: "POST" });
    };

    const handleDeactivate = () => {
        const selectedProducts = visibleItems
            .filter((item: any) => selectedCandidates.includes(item.id))
            .map((item: any) => ({
                id: item.id,
                title: item.title,
                sku: item.variants?.nodes?.[0]?.sku || ""
            }));

        submit({ actionType: "deactivate", selectedProducts: JSON.stringify(selectedProducts) }, { method: "POST" });
    };

    const handleClearLogs = () => {
        if (confirm("Are you sure you want to clear the activity history?")) {
            submit({ actionType: "clearLogs" }, { method: "POST" });
        }
    };

    const renderCandidateRow = (product: any, index: number) => (
        <IndexTable.Row
            id={product.id}
            key={product.id}
            selected={selectedCandidates.includes(product.id)}
            position={index}
        >
            <IndexTable.Cell>
                <Thumbnail
                    source={product.featuredImage?.url || ImageIcon}
                    alt={product.title}
                    size="small"
                />
            </IndexTable.Cell>
            <IndexTable.Cell>
                <Text variant="bodyMd" as="span">
                    {product.title}
                </Text>
            </IndexTable.Cell>
            <IndexTable.Cell>
                {product.sku}
            </IndexTable.Cell>
            <IndexTable.Cell>
                <Badge tone="critical">{`${product.daysInactive?.toString()} days inactive`}</Badge>
            </IndexTable.Cell>
            <IndexTable.Cell>Active</IndexTable.Cell>
        </IndexTable.Row>
    );

    return (
        <Page title="Manual Scan & Cleanup">
            <BlockStack gap="500">
                <Card>
                    <BlockStack gap="500">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                            <BlockStack gap="200">
                                <Text as="h2" variant="headingMd">
                                    Scan for Old Stock
                                </Text>
                                <Text variant="bodyMd" as="p" tone="subdued">
                                    Identify and set to Draft products that have been out of stock for a long time.
                                    Products are never deleted.
                                </Text>
                                {typedSettings?.lastRunAt && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <BlockStack gap="100">
                                            <Text as="span" variant="bodySm" tone="subdued">Last Scan:</Text>
                                            <InlineStack gap="200" align="start" blockAlign="center">
                                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                                    {new Date(typedSettings.lastRunAt).toLocaleString()}
                                                </Text>
                                                <Badge tone={typedSettings.lastScanType === 'AUTO' ? 'magic' : 'attention'}>
                                                    {typedSettings.lastScanType === 'AUTO' ? 'Auto-Scan' : 'Manual Scan'}
                                                </Badge>
                                            </InlineStack>
                                        </BlockStack>
                                    </div>
                                )}
                            </BlockStack>
                            <InlineStack gap="300" align="end">
                                <div style={{ width: "150px" }}>
                                    <TextField
                                        label="Days Inactive"
                                        type="number"
                                        value={daysThreshold}
                                        onChange={(value) => setDaysThreshold(value)}
                                        autoComplete="off"
                                        labelHidden
                                        placeholder="Threshold"
                                        suffix="days"
                                        helpText="Older than"
                                    />
                                </div>
                                <Box paddingBlockStart="050">
                                    <Button variant="primary" onClick={handleScan} loading={isScanning} disabled>
                                        {/* To disable: add 'disabled' prop above and remove 'disabled={isDeactivating}' */}
                                        Scan Now
                                    </Button>
                                </Box>
                            </InlineStack>
                        </div>

                        {visibleItems.length > 0 && (
                            <BlockStack gap="400">
                                <Banner tone={isReadonly ? "info" : "warning"}>
                                    {isReadonly
                                        ? `Last Auto-Scan moved ${visibleItems.length} products to Draft.`
                                        : `Found ${visibleItems.length} products eligible for Draft mode. Select to process.`
                                    }
                                </Banner>
                                <IndexTable
                                    resourceName={{ singular: 'product', plural: 'products' }}
                                    itemCount={visibleItems.length}
                                    selectedItemsCount={
                                        allCandidatesSelected ? 'All' : selectedCandidates.length
                                    }
                                    onSelectionChange={handleCandidateSelection}
                                    selectable={!isReadonly}
                                    headings={[
                                        { title: 'Image' },
                                        { title: 'Product' },
                                        { title: 'SKU' },
                                        { title: 'Inactive Time' },
                                        { title: 'Status' },
                                    ]}
                                    promotedBulkActions={isReadonly ? [] : [
                                        {
                                            content: 'Change to Draft',
                                            onAction: handleDeactivate,
                                            // @ts-expect-error loading sometimes mismatches in types
                                            loading: isDeactivating
                                        },
                                    ]}
                                >
                                    {visibleItems.map(renderCandidateRow)}
                                </IndexTable>
                            </BlockStack>
                        )}

                        {actionData && (actionData as any).candidates && (actionData as any).candidates.length === 0 && (
                            <Banner tone="success">
                                No old stock found! Your inventory is healthy.
                            </Banner>
                        )}

                    </BlockStack>
                </Card>

                <Card>
                    <BlockStack gap="300">
                        <InlineStack align="space-between">
                            <Text as="h2" variant="headingMd">
                                Recent Activity
                            </Text>
                            {logs.length > 0 && (
                                <Button variant="plain" tone="critical" onClick={handleClearLogs}>
                                    Clear History
                                </Button>
                            )}
                        </InlineStack>
                        {logs.length === 0 ? (
                            <Text as="p" tone="subdued">No activity yet.</Text>
                        ) : (
                            <IndexTable
                                resourceName={{ singular: 'log', plural: 'logs' }}
                                itemCount={logs.length}
                                selectedItemsCount={0}
                                onSelectionChange={() => { }}
                                headings={[
                                    { title: 'Date & Time' },
                                    { title: 'Action' },
                                    { title: 'Method' },
                                    { title: 'SKU' },
                                    { title: 'Name' },
                                    { title: 'ID' },
                                ]}
                                selectable={false}
                            >
                                {logs.map((log: any, index: number) => {
                                    const product = log.productDetails;
                                    const dateStr = new Date(log.createdAt).toLocaleString();

                                    // Action Label
                                    let actionLabel = log.action;
                                    let badgeTone: "success" | "critical" | "info" | "attention" | "magic" = "info";
                                    if (log.action === 'AUTO-DEACTIVATE') { actionLabel = 'Drafted'; badgeTone = 'info'; }
                                    else if (log.action === 'DEACTIVATE') { actionLabel = 'Drafted'; badgeTone = 'info'; }
                                    else if (log.action === 'REACTIVATE') { actionLabel = 'Reactivated'; badgeTone = 'success'; }

                                    // Method Label
                                    let methodLabel = log.method;

                                    if (methodLabel === 'WEBHOOK' || methodLabel === 'AUTO') {
                                        methodLabel = 'Auto';
                                    } else if (methodLabel === 'MANUAL') {
                                        methodLabel = 'Manual';
                                    }
                                    if (!methodLabel) {
                                        if (log.action === 'AUTO-DEACTIVATE' || log.action === 'REACTIVATE') methodLabel = 'Auto';
                                        else methodLabel = 'Manual';
                                    }

                                    const methodTone = methodLabel === 'Auto' ? 'magic' : 'info';
                                    const image = product?.featuredImage?.url;
                                    const sku = log.productSku || product?.variants?.nodes?.[0]?.sku || "-";
                                    const name = log.productTitle || product?.title || "Unknown Product";
                                    const id = log.productId;

                                    return (
                                        <IndexTable.Row id={log.id.toString()} key={log.id} position={index}>
                                            <IndexTable.Cell>
                                                {dateStr}
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Badge tone={badgeTone}>{actionLabel}</Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Badge tone={methodTone}>{methodLabel}</Badge>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Text variant="bodySm" as="span" fontWeight="bold">{sku}</Text>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <InlineStack gap="300" blockAlign="center">
                                                    {image ? (
                                                        <Thumbnail
                                                            source={image}
                                                            alt={name}
                                                            size="small"
                                                        />
                                                    ) : (
                                                        <div style={{ width: 40, height: 40, background: "#f1f1f1", borderRadius: 4 }}></div>
                                                    )}
                                                    <Text variant="bodyMd" as="span">{name}</Text>
                                                </InlineStack>
                                            </IndexTable.Cell>
                                            <IndexTable.Cell>
                                                <Text variant="bodySm" as="span" tone="subdued">{id.split("/").pop()}</Text>
                                            </IndexTable.Cell>
                                        </IndexTable.Row>
                                    );
                                })}
                            </IndexTable>
                        )}
                    </BlockStack>
                </Card>
            </BlockStack>
        </Page>
    );
}
