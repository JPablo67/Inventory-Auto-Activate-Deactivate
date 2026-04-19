import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useSearchParams, useNavigate } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Text,
    BlockStack,
    InlineStack,
    Button,
    Pagination
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ActivityLogTable } from "../components/ActivityLogTable";

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
                                    <ActivityLogTable
                                        logs={logs}
                                        deactivatedLabel="Changed to Draft"
                                        applyMethodFallback
                                    />

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
