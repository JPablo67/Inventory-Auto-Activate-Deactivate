import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation, Link as RemixLink, useRevalidator } from "@remix-run/react";
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
    Spinner,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { scanOldProducts, deactivateProducts } from "../services/inventory.server";
import db from "../db.server";
import { ActivityLogTable } from "../components/ActivityLogTable";

// Define Settings Interface
interface Settings {
    isActive: boolean;
    frequency: number;
    frequencyUnit: string;
    lastRunAt: string | null;
    minDaysInactive: number;
    lastScanType?: string;
    lastScanResults?: string;
    lastManualRunAt?: string | null;
    lastManualScanResults?: string;
    lastManualScanDays?: number | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);

    // 1. Fetch Settings
    const settings = await db.settings.findUnique({ where: { shop: session.shop } });

    // 2. Fetch Activity Log — all display data is stored directly in the table
    const logs = await db.activityLog.findMany({
        where: { shop: session.shop, method: 'MANUAL', action: 'DEACTIVATE' },
        take: 10,
        orderBy: { createdAt: "desc" },
    });

    return json({ settings, logs });
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
                lastManualRunAt: new Date(),
                lastManualScanResults: JSON.stringify(candidates),
                lastManualScanDays: days
            },
            create: {
                shop: settingsSession.shop,
                isActive: false,
                lastManualRunAt: new Date(),
                lastManualScanResults: JSON.stringify(candidates),
                lastManualScanDays: days
            }
        });

        return json({ candidates, success: true });
    }

    if (actionType === "deactivate") {
        const productsString = formData.get("selectedProducts") as string;
        let products;
        try { products = JSON.parse(productsString || "[]"); } catch { return json({ success: false, error: "Invalid product data" }); }

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
                        productImageUrl: product.featuredImage?.url || null,
                        method: "MANUAL",
                        action: "DEACTIVATE",
                    }
                });
            }
        }

        return json({ success: true, deactivatedCount: ids.length, ids });
    }

    if (actionType === "deactivateSingle") {
        const productString = formData.get("product") as string;
        let product;
        try { product = JSON.parse(productString || "{}"); } catch { return json({ success: false, error: "Invalid product data" }); }

        if (product.id) {
            await deactivateProducts(request, [product.id]);

            const shop = settingsSession.shop;
            await db.activityLog.create({
                data: {
                    shop,
                    productId: product.id,
                    productTitle: product.title,
                    productSku: product.sku,
                    productImageUrl: product.featuredImage?.url || null,
                    method: "MANUAL",
                    action: "DEACTIVATE",
                }
            });

            // Remove the product from persistent scan results so it doesn't reappear on reload
            const currentSettings = await db.settings.findUnique({ where: { shop } });
            if (currentSettings && currentSettings.lastManualScanResults) {
                try {
                    const parsedResults = JSON.parse(currentSettings.lastManualScanResults);
                    const updatedResults = parsedResults.filter((p: any) => p.id !== product.id);
                    await db.settings.update({
                        where: { shop },
                        data: { lastManualScanResults: JSON.stringify(updatedResults) }
                    });
                } catch (e) {
                    console.error("Failed to update lastScanResults after deactivation", e);
                }
            }
        }

        return json({ success: true, processedProduct: product });
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
    const revalidator = useRevalidator();

    const typedSettings = settings as Settings | null;

    // Resolve items to display
    const persistentResults = typedSettings?.lastManualScanResults ? JSON.parse(typedSettings.lastManualScanResults) : [];

    const activeCandidates = (actionData as any)?.candidates || [];
    const hasActiveCandidates = activeCandidates.length > 0;
    const visibleItems = hasActiveCandidates ? activeCandidates : persistentResults;

    const isReadonly = false;

    const {
        selectedResources: selectedCandidates,
        allResourcesSelected: allCandidatesSelected,
        handleSelectionChange: handleCandidateSelection,
        clearSelection: clearCandidateSelection
    } = useIndexResourceState(visibleItems);

    const [daysThreshold, setDaysThreshold] = useState(typedSettings?.lastManualScanDays?.toString() || "90");
    const [deactivatingIds, setDeactivatingIds] = useState<Set<string>>(new Set());
    const [completedProducts, setCompletedProducts] = useState<any[]>([]);
    const [isBatchProcessing, setIsBatchProcessing] = useState(false);

    useEffect(() => {
        if ((actionData as any)?.deactivatedCount) {
            shopify.toast.show(`${(actionData as any).deactivatedCount} products changed to Draft`);
            clearCandidateSelection();
        }
    }, [actionData, shopify]);

    const handleScan = () => {
        submit({ actionType: "scan", days: daysThreshold }, { method: "POST" });
    };

    const handleDeactivate = async () => {
        const selectedProducts = visibleItems
            .filter((item: any) => selectedCandidates.includes(item.id))
            .map((item: any) => ({
                id: item.id,
                title: item.title,
                sku: item.sku || item.variants?.nodes?.[0]?.sku || "",
                featuredImage: item.featuredImage
            }));

        if (selectedProducts.length === 0) return;

        setIsBatchProcessing(true);

        for (const product of selectedProducts) {
            setDeactivatingIds(prev => new Set(prev).add(product.id));

            const formData = new FormData();
            formData.append("actionType", "deactivateSingle");
            formData.append("product", JSON.stringify(product));

            try {
                const response = await fetch("?index", {
                    method: "POST",
                    body: formData,
                });
                if (response.ok) {
                    setCompletedProducts(prev => [product, ...prev]);
                }
            } catch (err) {
                console.error("Failed to deactivate", product.title);
            } finally {
                setDeactivatingIds(prev => {
                    const next = new Set(prev);
                    next.delete(product.id);
                    return next;
                });
            }
        }

        setIsBatchProcessing(false);
        clearCandidateSelection();
        shopify.toast.show(`Processed ${selectedProducts.length} products`);
        revalidator.revalidate(); // Refresh loaders
    };

    const handleClearLogs = () => {
        if (confirm("Are you sure you want to clear the activity history?")) {
            submit({ actionType: "clearLogs" }, { method: "POST" });
        }
    };

    const renderCandidateRow = (product: any, index: number) => {
        const isDeactivatingThis = deactivatingIds.has(product.id);

        return (
            <IndexTable.Row
                id={product.id}
                key={product.id}
                selected={selectedCandidates.includes(product.id)}
                position={index}
                disabled={isBatchProcessing} // prevent selection changes while processing
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
                    {isDeactivatingThis ? (
                        <InlineStack gap="200" blockAlign="center">
                            <Spinner size="small" />
                            <Text variant="bodySm" as="span" tone="subdued">Drafting...</Text>
                        </InlineStack>
                    ) : (
                        <Badge tone="critical">{`${product.daysInactive?.toString()} days with no stock`}</Badge>
                    )}
                </IndexTable.Cell>
                <IndexTable.Cell>
                    {isDeactivatingThis ? <Badge tone="info">Updating</Badge> : "Active"}
                </IndexTable.Cell>
            </IndexTable.Row>
        );
    };

    // Calculate lists for display
    const realVisibleItems = visibleItems.filter((item: any) => !completedProducts.some(p => p.id === item.id));

    // Deduped optimistic logs
    const optimisticLogs = completedProducts.map((p, index) => ({
        id: `opt-${index}-${p.id}`,
        createdAt: new Date().toISOString(),
        action: 'DEACTIVATE',
        method: 'MANUAL',
        productSku: p.sku,
        productTitle: p.title,
        productId: p.id,
        productImageUrl: p.featuredImage?.url || null
    }));

    // Merge logs ensuring no temporary duplicates
    const combinedLogs = [
        ...optimisticLogs.filter(opt => !logs.some((l: any) => l.productId === opt.productId && l.action === 'DEACTIVATE' && new Date(l.createdAt).getTime() > Date.now() - 5 * 60 * 1000)),
        ...logs
    ].slice(0, 20);

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
                                {typedSettings?.lastManualRunAt && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <BlockStack gap="100">
                                            <Text as="span" variant="bodySm" tone="subdued">Last Scan:</Text>
                                            <InlineStack gap="200" align="start" blockAlign="center">
                                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                                    {new Date(typedSettings.lastManualRunAt).toLocaleString()}
                                                </Text>
                                            </InlineStack>
                                        </BlockStack>
                                    </div>
                                )}
                            </BlockStack>
                            <InlineStack gap="300" align="end" blockAlign="center">
                                <Text as="span" variant="bodyMd">
                                    Products that have been out of stock for more than:
                                </Text>
                                <div style={{ width: "120px" }}>
                                    <TextField
                                        label="Days Inactive"
                                        type="number"
                                        value={daysThreshold}
                                        onChange={(value) => setDaysThreshold(value)}
                                        autoComplete="off"
                                        labelHidden
                                        placeholder="Threshold"
                                        suffix="days"
                                    />
                                </div>
                                <Button variant="primary" onClick={handleScan} loading={isScanning} disabled={isBatchProcessing}>
                                    Scan Now
                                </Button>
                            </InlineStack>
                        </div>

                        {realVisibleItems.length > 0 && (
                            <BlockStack gap="400">
                                <Banner tone={isReadonly ? "info" : "warning"}>
                                    {isReadonly
                                        ? `Last Auto-Scan moved ${realVisibleItems.length} products to Draft.`
                                        : `Found ${realVisibleItems.length} products eligible for Draft mode. Select to process.`
                                    }
                                </Banner>
                                <IndexTable
                                    resourceName={{ singular: 'product', plural: 'products' }}
                                    itemCount={realVisibleItems.length}
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
                                            disabled: isBatchProcessing
                                        },
                                    ]}
                                >
                                    {realVisibleItems.map(renderCandidateRow)}
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
                        {combinedLogs.length === 0 ? (
                            <Text as="p" tone="subdued">No activity yet.</Text>
                        ) : (
                            <>
                                <ActivityLogTable
                                    logs={combinedLogs}
                                    deactivatedLabel="Drafted"
                                    applyMethodFallback
                                    handleInvalidDate
                                />
                                {logs && logs.length >= 10 && (
                                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', paddingBottom: '1rem' }}>
                                        <Button url="/app/activity" variant="plain">
                                            View all activity
                                        </Button>
                                    </div>
                                )}
                            </>
                        )}
                    </BlockStack>
                </Card>
            </BlockStack>
        </Page>
    );
}
