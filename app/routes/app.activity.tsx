import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useNavigate } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Text,
    IndexTable,
    Badge,
    Thumbnail,
    BlockStack,
    InlineStack,
    Button,
    Pagination
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const PAGE_SIZE = 50;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const filter = url.searchParams.get("filter") || "all";
    const skip = (page - 1) * PAGE_SIZE;

    // Filter Logic
    let whereClause: any = { shop: session.shop };
    if (filter === 'deactivated') {
        whereClause.action = { in: ['DEACTIVATE', 'AUTO-DEACTIVATE'] };
    } else if (filter === 'reactivated') {
        whereClause.action = 'REACTIVATE';
    }

    // Fetch total count for pagination
    const totalCount = await db.activityLog.count({
        where: whereClause
    });

    // Fetch logs — all display data is stored directly in the table
    const logs = await db.activityLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: skip,
        take: PAGE_SIZE
    });

    return json({
        logs,
        page,
        totalPages: Math.ceil(totalCount / PAGE_SIZE),
        totalCount
    });
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "clearLogs") {
        await db.activityLog.deleteMany({
            where: { shop: session.shop }
        });
        return json({ success: true });
    }

    return json({ success: false });
};

export default function ActivityLogPage() {
    const { logs, page, totalPages, totalCount } = useLoaderData<typeof loader>();
    const submit = useSubmit();
    const navigation = useNavigation();
    const navigate = useNavigate();

    const [searchParams] = useSearchParams();
    const filter = searchParams.get("filter") || "all";

    const handleClearLogs = () => {
        if (confirm("Are you sure you want to clear the entire activity history?")) {
            submit({ actionType: "clearLogs" }, { method: "POST" });
        }
    };

    const handleFilterChange = (newFilter: string) => {
        navigate(`?filter=${newFilter}&page=1`);
    };

    const isLoading = navigation.state === "submitting" || navigation.state === "loading";

    return (
        <Page title="Activity Log" fullWidth>
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                                <InlineStack gap="400" blockAlign="center">
                                    <Text as="h2" variant="headingMd">
                                        Full History ({totalCount})
                                    </Text>
                                    <InlineStack gap="200">
                                        <Button
                                            pressed={filter === 'all'}
                                            variant={filter === 'all' ? 'primary' : 'tertiary'}
                                            onClick={() => handleFilterChange('all')}
                                            size="micro"
                                        >All</Button>
                                        <Button
                                            pressed={filter === 'deactivated'}
                                            variant={filter === 'deactivated' ? 'primary' : 'tertiary'}
                                            onClick={() => handleFilterChange('deactivated')}
                                            size="micro"
                                        >Deactivated</Button>
                                        <Button
                                            pressed={filter === 'reactivated'}
                                            variant={filter === 'reactivated' ? 'primary' : 'tertiary'}
                                            onClick={() => handleFilterChange('reactivated')}
                                            size="micro"
                                        >Reactivated</Button>
                                    </InlineStack>
                                </InlineStack>
                                {logs.length > 0 && (
                                    <Button variant="plain" tone="critical" onClick={handleClearLogs} loading={isLoading}>
                                        Clear History
                                    </Button>
                                )}
                            </InlineStack>

                            {logs.length === 0 ? (
                                <Text as="p" tone="subdued">No activity found.</Text>
                            ) : (
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

                                            if (log.action === 'AUTO-DEACTIVATE') { actionLabel = 'Changed to Draft'; badgeTone = 'info'; }
                                            else if (log.action === 'DEACTIVATE') { actionLabel = 'Changed to Draft'; badgeTone = 'info'; }
                                            else if (log.action === 'REACTIVATE') { actionLabel = 'Reactivated'; badgeTone = 'success'; }

                                            // Method Label
                                            let methodLabel = log.method;
                                            let methodTone: "success" | "critical" | "info" | "attention" | "magic" = "subdued" as any;

                                            // Normalize Webhook/Auto to "Auto"
                                            if (methodLabel === 'WEBHOOK' || methodLabel === 'AUTO') {
                                                methodLabel = 'Auto';
                                                methodTone = 'magic';
                                            } else if (methodLabel === 'MANUAL') {
                                                methodLabel = 'Manual';
                                                methodTone = 'attention';
                                            }
                                            // Fallback
                                            if (!methodLabel) {
                                                if (log.action === 'AUTO-DEACTIVATE' || log.action === 'REACTIVATE') {
                                                    methodLabel = 'Auto';
                                                    methodTone = 'magic';
                                                } else {
                                                    methodLabel = 'Manual';
                                                    methodTone = 'attention';
                                                }
                                            }

                                            // SKU & Name
                                            const image = log.productImageUrl;
                                            const sku = log.productSku || "-";
                                            const name = log.productTitle || "Unknown Product";
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

                                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
                                        <Pagination
                                            hasPrevious={page > 1}
                                            onPrevious={() => navigate(`?page=${page - 1}&filter=${filter}`)}
                                            hasNext={page < totalPages}
                                            onNext={() => navigate(`?page=${page + 1}&filter=${filter}`)}
                                        />
                                    </div>
                                </>
                            )}
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
