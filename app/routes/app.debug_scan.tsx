
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, Button, Box } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { executeDebugScan } from "../services/scheduler.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);

    // RUN DEBUG SCAN
    // This will force the logic to run immediately for the current shop
    // We pass 'admin' to bypass offline session issues for now
    const logs = await executeDebugScan(session.shop, admin);

    return json({ logs });
};

export default function DebugRoute() {
    const { logs } = useLoaderData<typeof loader>();

    return (
        <Page title="Debug Auto-Scan">
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">Execution Logs</Text>
                            <Text as="p" tone="subdued">
                                Below is the output from running the "Auto-Scan" logic manually right now.
                            </Text>

                            <Box background="bg-surface-secondary" padding="400" borderRadius="200" overflowX="scroll">
                                <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", fontFamily: "monospace" }}>
                                    {logs.join("\n")}
                                </pre>
                            </Box>

                            <Link to="/app">Back to Dashboard</Link>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
