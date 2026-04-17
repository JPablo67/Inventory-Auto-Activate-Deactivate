import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, useRevalidator } from "@remix-run/react";
import { useAuthenticatedPoll } from "../hooks/useAuthenticatedFetch";
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
    ProgressBar,
    FormLayout
} from "@shopify/polaris";
import { useState, useEffect, useRef } from "react";
import db from "../db.server";
import shopify from "../shopify.server";
import { saveAutoSettings } from "../services/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);
    const settings = await db.settings.findUnique({ where: { shop: session.shop } });

    return json({ settings, logs: [] });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "saveSettings") {
        await saveAutoSettings({
            shop: session.shop,
            isActive: formData.get("isActive") === "true",
            frequency: parseInt(formData.get("frequency") as string, 10),
            frequencyUnit: formData.get("frequencyUnit") as string,
            minDaysInactive: parseInt(formData.get("minDaysInactive") as string || "90", 10),
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

    const [isRunning, setIsRunning] = useState(false);
    const { data: statusData } = useAuthenticatedPoll<{ settings?: any; latestLogId?: number; currentStatus?: string }>({
        url: '/api/status',
        intervalMs: isRunning ? 3000 : 15000,
    });

    const realtimeSettings = { ...settings, ...(statusData?.settings || {}) };
    const currentStatus = realtimeSettings?.currentStatus || "IDLE";
    const isActive = realtimeSettings?.isActive;
    useEffect(() => {
        setIsRunning(currentStatus !== 'IDLE');
    }, [currentStatus]);

    // Logs: initial load + refetch when latestLogId changes
    const [logs, setLogs] = useState<any[]>(initialLogs);
    const [logsLoading, setLogsLoading] = useState(false);
    const latestLogIdFromStatus = statusData?.latestLogId;
    const lastSeenLogId = useRef<number | null>(null);
    const { refetch: refetchLogs } = useAuthenticatedPoll<{ logs: any[] }>({
        url: '/api/logs?method=AUTO&action=AUTO-DEACTIVATE',
        intervalMs: 60_000,
        onData: (d) => setLogs(d.logs),
    });

    useEffect(() => {
        if (latestLogIdFromStatus && latestLogIdFromStatus !== lastSeenLogId.current) {
            lastSeenLogId.current = latestLogIdFromStatus;
            setLogsLoading(true);
            refetchLogs().finally(() => setLogsLoading(false));
        }
    }, [latestLogIdFromStatus, refetchLogs]);

    const isLoading = navigation.state === "submitting" || navigation.state === "loading";

    // Frequency must be a multiple of 5 in [5, 90] — UI is a fixed dropdown.
    const FREQUENCY_OPTIONS = Array.from({ length: 18 }, (_, i) => {
        const v = String((i + 1) * 5);
        return { label: v, value: v };
    });
    const normalizeFrequency = (n: number | undefined) => {
        if (!n || n < 5) return "5";
        if (n > 90) return "90";
        const rounded = Math.round(n / 5) * 5;
        return String(Math.min(90, Math.max(5, rounded)));
    };

    // User State
    const [autoEnabled, setAutoEnabled] = useState(settings?.isActive ? 'true' : 'false');
    const [autoMinDays, setAutoMinDays] = useState(settings?.minDaysInactive?.toString() || "90");
    const [frequency, setFrequency] = useState(normalizeFrequency(settings?.frequency));
    const [frequencyUnit, setFrequencyUnit] = useState(settings?.frequencyUnit || "days");
    const [isAutoScanResultsExpanded, setIsAutoScanResultsExpanded] = useState(false);

    // Timer calculation logic (reused from index)
    const [timeLeft, setTimeLeft] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    // Sync Toggle Switch if external update changes it
    useEffect(() => {
        setAutoEnabled(isActive ? 'true' : 'false');
    }, [isActive]);

    // App Bridge session token + visibility-aware polling are handled inside
    // useAuthenticatedPoll. Recovery on persistent failure is built in.

    useEffect(() => {
        if (!realtimeSettings?.isActive || !realtimeSettings?.nextRunAt) {
            setTimeLeft(null);
            setProgress(0);
            return;
        }

        // Anchor for the progress bar: prefer lastRunAt (post-first-scan), else
        // derive the start of this interval from nextRunAt - one full frequency.
        const intervalMs = realtimeSettings.frequencyUnit === "days"
            ? realtimeSettings.frequency * 24 * 60 * 60 * 1000
            : realtimeSettings.frequency * 60 * 1000;

        const nextRun = new Date(realtimeSettings.nextRunAt).getTime();
        const intervalStart = realtimeSettings.lastRunAt
            ? new Date(realtimeSettings.lastRunAt).getTime()
            : nextRun - intervalMs;

        const tick = () => {
            const now = Date.now();
            const diff = nextRun - now;
            const totalDuration = nextRun - intervalStart;

            if (diff <= 0) {
                setTimeLeft("Pending...");
                setProgress(100);
            } else {
                const p = Math.max(0, Math.min(100, ((totalDuration - diff) / totalDuration) * 100));
                setProgress(p);

                const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const s = Math.floor((diff % (1000 * 60)) / 1000);

                if (d > 0) setTimeLeft(`${d}d ${h}h`);
                else if (h > 0) setTimeLeft(`${h}h ${m}m`);
                else if (m > 0) setTimeLeft(`${m}m ${s}s`);
                else setTimeLeft(`${s}s`);
            }
        };

        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [realtimeSettings?.isActive, realtimeSettings?.nextRunAt, realtimeSettings?.lastRunAt, realtimeSettings?.frequency, realtimeSettings?.frequencyUnit]);

    const handleToggleAuto = (isChecked: boolean) => {
        const newValue = isChecked ? 'true' : 'false';
        setAutoEnabled(newValue);

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
                                        cursor: 'pointer',
                                        position: 'relative',
                                        width: '48px',
                                        height: '28px',
                                        backgroundColor: autoEnabled === 'true' ? 'var(--p-color-bg-fill-success)' : '#d2d5d8',
                                        borderRadius: '100px',
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
                                                <div style={{ width: `${progress}%`, height: '100%', background: 'var(--p-color-bg-fill-success)', transition: 'width 1s linear' }} />
                                            </div>
                                        )}
                                    </BlockStack>
                                </div>
                            )}

                            <BlockStack gap="400">
                                <Text as="p" variant="bodyMd">
                                    Configure the schedule below. Enable the switch above to save and start the automation.
                                </Text>

                                <FormLayout>
                                    <FormLayout.Group>
                                        <TextField
                                            label="Products that have been out of stock for more than:"
                                            type="number"
                                            value={autoMinDays}
                                            onChange={setAutoMinDays}
                                            autoComplete="off"
                                            disabled={autoEnabled === 'true'}
                                            suffix="days"
                                        />
                                        <Select
                                            label="Run Scan Every"
                                            options={FREQUENCY_OPTIONS}
                                            value={frequency}
                                            onChange={setFrequency}
                                            disabled={autoEnabled === 'true'}
                                            helpText={`Every ${frequency} ${frequencyUnit}`}
                                        />
                                        <Select
                                            label="Unit"
                                            options={[
                                                { label: 'Days', value: 'days' },
                                                { label: 'Minutes', value: 'minutes' },
                                            ]}
                                            value={frequencyUnit}
                                            onChange={setFrequencyUnit}
                                            disabled={autoEnabled === 'true'}
                                        />
                                    </FormLayout.Group>
                                </FormLayout>
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
                                                {results.slice(0, isAutoScanResultsExpanded ? results.length : 5).map((product: any, index: number) => {
                                                    const sku = product.sku || '-';
                                                    return (
                                                        <IndexTable.Row id={product.id || index.toString()} key={product.id || index} position={index}>
                                                            <IndexTable.Cell>
                                                                <Text as="span" variant="bodyMd" fontWeight="bold">{product.title}</Text>
                                                            </IndexTable.Cell>
                                                            <IndexTable.Cell>{sku}</IndexTable.Cell>
                                                            <IndexTable.Cell>Deactivated</IndexTable.Cell>
                                                        </IndexTable.Row>
                                                    );
                                                })}
                                            </IndexTable>
                                            {count > 5 && !isAutoScanResultsExpanded && (
                                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                                                    <Button variant="plain" onClick={() => setIsAutoScanResultsExpanded(true)}>
                                                        {`Expand ${count - 5} more`}
                                                    </Button>
                                                </div>
                                            )}
                                            {isAutoScanResultsExpanded && count > 5 && (
                                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                                                    <Button variant="plain" onClick={() => setIsAutoScanResultsExpanded(false)}>
                                                        Show less
                                                    </Button>
                                                </div>
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
                                {(!logs || logs.length === 0) && logsLoading ? (
                                    <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}><Spinner /></div>
                                ) : logs && logs.length > 0 ? (
                                    <>
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
                                                const image = log.productImageUrl;
                                                const sku = log.productSku || '-';
                                                const name = log.productTitle || 'Unknown Product';
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
                                                            <InlineStack gap="300" blockAlign="start" wrap={false}>
                                                                <div>
                                                                    {image ? (
                                                                        <Thumbnail
                                                                            source={image}
                                                                            alt={name}
                                                                            size="small"
                                                                        />
                                                                    ) : (
                                                                        <div style={{ width: 40, height: 40, background: "#f1f1f1", borderRadius: 4 }}></div>
                                                                    )}
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word", whiteSpace: "normal" }}>
                                                                    <Text variant="bodyMd" as="span">{name}</Text>
                                                                </div>
                                                            </InlineStack>
                                                        </IndexTable.Cell>
                                                        <IndexTable.Cell>
                                                            <Text variant="bodySm" as="span" tone="subdued">{id.split("/").pop()}</Text>
                                                        </IndexTable.Cell>
                                                    </IndexTable.Row>
                                                );
                                            })}
                                        </IndexTable>
                                        {logs.length >= 10 && (
                                            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem', paddingBottom: '1rem' }}>
                                                <Button url="/app/activity" variant="plain">
                                                    View all activity
                                                </Button>
                                            </div>
                                        )}
                                    </>
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
