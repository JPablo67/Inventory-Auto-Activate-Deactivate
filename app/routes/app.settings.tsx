import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useRevalidator, useFetcher } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Button,
    Text,
    BlockStack,
    InlineStack,
    Banner,
    TextField,
    Select,
    Box,
    Spinner,
    Thumbnail,
    IndexTable,
    Badge,
    Checkbox,
    ProgressBar
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import db from "../db.server";
import shopify from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await shopify.authenticate.admin(request);
    const settings = await db.settings.findUnique({ where: { shop: session.shop } });

    return json({ settings, logs: [] });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "saveSettings") {
        const isActive = formData.get("isActive") === "true";
        const frequency = parseInt(formData.get("frequency") as string, 10);
        const frequencyUnit = formData.get("frequencyUnit") as string;
        const minDaysInactive = parseInt(formData.get("minDaysInactive") as string || "90", 10);

        await db.settings.upsert({
            where: { shop: session.shop },
            update: { isActive, frequency, frequencyUnit, minDaysInactive },
            create: { shop: session.shop, isActive, frequency, frequencyUnit, minDaysInactive }
        });

        return json({ success: true, savedSettings: true });
    }

    return null;
};

export default function SettingsPage() {
    const { settings, logs: initialLogs } = useLoaderData<typeof loader>();
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const revalidator = useRevalidator();
    const statusFetcher = useFetcher<any>();
    const logsFetcher = useFetcher<any>();

    // Real-time source of truth (Merge initial settings with updates)
    const realtimeSettings = { ...settings, ...(statusFetcher.data?.settings || {}) };
    const currentStatus = realtimeSettings?.currentStatus || "IDLE";
    const isActive = realtimeSettings?.isActive;
    const isRunning = currentStatus !== 'IDLE';

    const logs = logsFetcher.data?.logs || initialLogs;
    const latestLogIdFromStatus = statusFetcher.data?.latestLogId;
    const currentLatestLogId = logs && logs.length > 0 ? logs[0].id : null;

    // Load logs on mount OR if status says there's a new log
    useEffect(() => {
        // Initial load
        if (logsFetcher.state === 'idle' && !logsFetcher.data) {
            logsFetcher.load('/api/logs');
            return;
        }

        // Real-time update check
        if (latestLogIdFromStatus && latestLogIdFromStatus !== currentLatestLogId && logsFetcher.state === 'idle') {
            console.log("New activity detected! Refreshing logs...", latestLogIdFromStatus, currentLatestLogId);
            logsFetcher.load('/api/logs');
        }
    }, [latestLogIdFromStatus, currentLatestLogId, logsFetcher.state]);

    const isLoading = navigation.state === "submitting" || navigation.state === "loading";

    // User State
    const [autoEnabled, setAutoEnabled] = useState(settings?.isActive ? 'true' : 'false');
    const [autoMinDays, setAutoMinDays] = useState(settings?.minDaysInactive?.toString() || "90");
    const [frequency, setFrequency] = useState(settings?.frequency?.toString() || "1");
    const [frequencyUnit, setFrequencyUnit] = useState(settings?.frequencyUnit || "days");

    // Timer calculation logic (reused from index)
    const [timeLeft, setTimeLeft] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    // Sync Toggle Switch if external update changes it
    useEffect(() => {
        setAutoEnabled(isActive ? 'true' : 'false');
    }, [isActive]);

    // Polling active status
    useEffect(() => {
        const intervalMs = isRunning ? 1000 : 5000;
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible' && statusFetcher.state === 'idle') {
                statusFetcher.load('/api/status');
            }
        }, intervalMs);
        return () => clearInterval(interval);
    }, [isRunning, statusFetcher]);

    useEffect(() => {
        if (!realtimeSettings?.isActive || !realtimeSettings?.lastRunAt) {
            setTimeLeft(null);
            setProgress(0);
            return;
        }

        const interval = setInterval(() => {
            const lastRun = new Date(realtimeSettings.lastRunAt!).getTime();
            const now = Date.now();
            let nextRun = lastRun;

            if (realtimeSettings.frequencyUnit === 'days') {
                nextRun += realtimeSettings.frequency * 24 * 60 * 60 * 1000;
            } else { // minutes
                nextRun += realtimeSettings.frequency * 60 * 1000;
            }

            const diff = nextRun - now;
            const totalDuration = nextRun - lastRun;

            if (diff <= 0) {
                setTimeLeft("Pending...");
                setProgress(100);
            } else {
                const p = Math.max(0, Math.min(100, ((totalDuration - diff) / totalDuration) * 100));
                setProgress(p);

                // Format friendly time
                const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

                if (d > 0) setTimeLeft(`${d}d ${h} h`);
                else if (h > 0) setTimeLeft(`${h}h ${m} m`);
                else setTimeLeft(`${m} m`);
            }

        }, 1000);

        return () => clearInterval(interval);
    }, [realtimeSettings]);

    const handleToggleAuto = (isChecked: boolean) => {
        const newValue = isChecked ? 'true' : 'false';
        setAutoEnabled(newValue);

        // Immediate save on toggle
        submit({
            actionType: "saveSettings",
            isActive: newValue,
            frequency,
            frequencyUnit,
            minDaysInactive: autoMinDays
        }, { method: "POST" });
    };



    return (
        <Page title="Auto-Deactivate Settings">
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            {actionData?.success && (
                                <Banner tone="success" onDismiss={() => { }}>Settings saved successfully.</Banner>
                            )}

                            <InlineStack align="space-between" blockAlign="center">
                                <BlockStack gap="200">
                                    <Text as="h2" variant="headingMd">Auto-Deactivate Configuration (Draft Mode)</Text>
                                    <Badge tone="info">Non-Destructive</Badge>
                                    <Text as="p" tone={autoEnabled === 'true' ? 'success' : 'subdued'}>
                                        {autoEnabled === 'true' ? 'Active & Running' : 'Disabled'}
                                    </Text>
                                </BlockStack>

                                {/* Custom Toggle Switch */}
                                <div
                                    role="switch"
                                    aria-checked={autoEnabled === 'true'}
                                    onClick={() => handleToggleAuto(autoEnabled !== 'true')}
                                    style={{
                                        position: 'relative',
                                        width: '48px',
                                        height: '28px',
                                        backgroundColor: autoEnabled === 'true' ? 'var(--p-color-bg-fill-success)' : '#d2d5d8', // Explicit Gray
                                        borderRadius: '100px',
                                        cursor: 'pointer',
                                        transition: 'background-color 0.2s ease-in-out'
                                    }}
                                >
                                    <div style={{
                                        position: 'absolute',
                                        top: '2px',
                                        left: autoEnabled === 'true' ? '22px' : '2px',
                                        width: '24px',
                                        height: '24px',
                                        backgroundColor: 'white',
                                        borderRadius: '50%',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                        transition: 'left 0.2s ease-in-out'
                                    }} />
                                </div>
                            </InlineStack>

                            {/* Timer Display */}
                            {(timeLeft || isRunning) && autoEnabled === 'true' && (
                                <div style={{ background: "var(--p-color-bg-surface-secondary)", borderRadius: "8px", padding: "12px", border: "1px solid var(--p-color-border)" }}>
                                    <BlockStack gap="200">
                                        <InlineStack align="space-between">
                                            <Text as="span" variant="bodySm" tone="subdued">
                                                {isRunning ? "Current Status" : "Next Scheduled Run"}
                                            </Text>
                                            {isRunning ? (
                                                <InlineStack gap="200" blockAlign="center">
                                                    <Spinner size="small" />
                                                    <Text as="span" variant="bodySm" fontWeight="bold" tone="success">{currentStatus}</Text>
                                                </InlineStack>
                                            ) : (
                                                <Text as="span" variant="bodySm" fontWeight="bold">{timeLeft}</Text>
                                            )}
                                        </InlineStack>
                                        {!isRunning && (
                                            <div style={{ height: '4px', background: 'var(--p-color-bg-surface-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                                                <div style={{ width: `${progress}% `, height: '100%', background: 'var(--p-color-bg-fill-success)', transition: 'width 1s linear' }} />
                                            </div>
                                        )}
                                    </BlockStack>
                                </div>
                            )}

                            <BlockStack gap="400">
                                <Text as="p" variant="bodyMd">
                                    Configure the schedule below. Enable the switch above to save and start the automation.
                                </Text>

                                <Layout>
                                    <Layout.Section variant="oneHalf">
                                        <TextField
                                            label="Deactivate (Change to Draft) products that have been out of stock for more than:"
                                            type="number"
                                            value={autoMinDays}
                                            onChange={setAutoMinDays}
                                            autoComplete="off"
                                            disabled={autoEnabled === 'true'}
                                            suffix="days"
                                        />
                                    </Layout.Section>
                                    <Layout.Section variant="oneHalf">
                                        <TextField
                                            label="Run Scan Every"
                                            type="number"
                                            value={frequency}
                                            onChange={setFrequency}
                                            autoComplete="off"
                                            disabled={autoEnabled === 'true'}
                                            connectedRight={
                                                <Select
                                                    label="Unit"
                                                    labelHidden
                                                    options={[
                                                        { label: 'Days', value: 'days' },
                                                        { label: 'Minutes', value: 'minutes' },
                                                    ]}
                                                    value={frequencyUnit}
                                                    onChange={setFrequencyUnit}
                                                    disabled={autoEnabled === 'true'}
                                                />
                                            }
                                        />
                                    </Layout.Section>
                                </Layout>
                            </BlockStack>
                        </BlockStack>
                    </Card>

                    {/* Last Auto-Scan Results */}
                    {/* Last Auto-Scan Results */}
                    <Box paddingBlockStart="400">
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Last Auto-Scan Results</Text>
                                {(() => {
                                    if (!realtimeSettings?.lastRunAt || !realtimeSettings?.lastScanResults) {
                                        return (
                                            <Banner tone="info">
                                                <p>The auto-deactivation job hasn't run yet.</p>
                                            </Banner>
                                        );
                                    }

                                    let results = [];
                                    try {
                                        results = JSON.parse(realtimeSettings.lastScanResults);
                                    } catch (e) {
                                        console.error("Failed to parse scan results", e);
                                    }

                                    const count = results.length;
                                    if (count === 0) {
                                        return (
                                            <Banner tone="success">
                                                <p>
                                                    The last automatic scan on <strong>{new Date(realtimeSettings.lastRunAt).toLocaleString()}</strong> found <strong>0 products</strong> matching the deactivation criteria. Everything is clean!
                                                </p>
                                            </Banner>
                                        );
                                    }

                                    return (
                                        <>
                                            <Banner tone="info">
                                                <p>
                                                    The last automatic scan on <strong>{new Date(realtimeSettings.lastRunAt).toLocaleString()}</strong> deactivated <strong>{count} products</strong>.
                                                </p>
                                            </Banner>
                                            <IndexTable
                                                resourceName={{ singular: 'product', plural: 'products' }}
                                                itemCount={count}
                                                selectedItemsCount={0}
                                                onSelectionChange={() => { }}
                                                headings={[
                                                    { title: 'Product' },
                                                    { title: 'SKU' },
                                                    { title: 'Status' }
                                                ]}
                                                selectable={false}
                                            >
                                                {results.slice(0, 5).map((product: any, index: number) => (
                                                    <IndexTable.Row id={product.id || index.toString()} key={product.id || index} position={index}>
                                                        <IndexTable.Cell>
                                                            <Text as="span" variant="bodyMd" fontWeight="bold">{product.title}</Text>
                                                        </IndexTable.Cell>
                                                        <IndexTable.Cell>{product.sku || '-'}</IndexTable.Cell>
                                                        <IndexTable.Cell>Deactivated</IndexTable.Cell>
                                                    </IndexTable.Row>
                                                ))}
                                            </IndexTable>
                                            {count > 5 && (
                                                <Text as="p" tone="subdued" alignment="center">...and {count - 5} more.</Text>
                                            )}
                                        </>
                                    );
                                })()}
                            </BlockStack>
                        </Card>
                    </Box>

                    {/* Recent Activity */}
                    <Box paddingBlockStart="400">
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Recent Activity</Text>
                                {(!logs || logs.length === 0) && logsFetcher.state === 'loading' ? (
                                    <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}><Spinner /></div>
                                ) : logs && logs.length > 0 ? (
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
                                            if (log.action === 'AUTO-DEACTIVATE') { actionLabel = 'Deactivated'; badgeTone = 'info'; }
                                            else if (log.action === 'DEACTIVATE') { actionLabel = 'Deactivated'; badgeTone = 'info'; }
                                            else if (log.action === 'REACTIVATE') { actionLabel = 'Reactivated'; badgeTone = 'success'; }

                                            // Method Label
                                            let methodLabel = log.method;
                                            let methodTone: "success" | "critical" | "info" | "attention" | "magic" = "subdued" as any; // default

                                            if (methodLabel === 'WEBHOOK' || methodLabel === 'AUTO') {
                                                methodLabel = 'Auto';
                                                methodTone = 'magic';
                                            } else if (methodLabel === 'MANUAL') {
                                                methodLabel = 'Manual';
                                                methodTone = 'attention';
                                            }

                                            // Product Details
                                            const image = product?.featuredImage?.url;
                                            const sku = log.productSku || product?.variants?.nodes?.[0]?.sku || '-';
                                            const name = log.productTitle || product?.title || 'Unknown Product';
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
                                ) : (
                                    <Text as="p" tone="subdued">No recent activity.</Text>
                                )}
                            </BlockStack>
                        </Card>
                    </Box>

                </Layout.Section>
            </Layout>
        </Page>
    );
}
