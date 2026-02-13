import { json, type LoaderFunctionArgs } from "@remix-run/node";
import shopify from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session, admin } = await shopify.authenticate.admin(request);

    // Fetch all logs
    const logs = await db.activityLog.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: 'desc' },
        take: 1000
    });

    // Enrich logs with Shopify Product Data
    const logProductIds = [...new Set(logs.map((l) => l.productId).filter((id) => id))];
    const logProductsMap: Record<string, any> = {};

    if (logProductIds.length > 0) {
        const chunkSize = 50;
        const query = `query getLogProducts($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title handle status featuredImage { url } variants(first: 1) { nodes { sku } } } } }`;

        for (let i = 0; i < logProductIds.length; i += chunkSize) {
            const chunk = logProductIds.slice(i, i + chunkSize);
            try {
                const response = await admin.graphql(query, { variables: { ids: chunk } });
                const responseJson = await response.json();
                const nodes = (responseJson as any).data?.nodes || [];

                nodes.forEach((node: any) => {
                    if (node && node.id) {
                        logProductsMap[node.id] = node;
                    }
                });
            } catch (e) {
                console.error("Failed to fetch details for log products chunk:", e);
            }
        }
    }

    const enrichedLogs = logs.map((log) => ({
        ...log,
        productDetails: logProductsMap[log.productId] || null,
    }));

    return json({ logs: enrichedLogs });
};
