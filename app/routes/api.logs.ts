import { json, type LoaderFunctionArgs } from "@remix-run/node";
import shopify from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);

    const url = new URL(request.url);
    const methodFilter = url.searchParams.get("method");
    const actionFilter = url.searchParams.get("action");

    const whereClause: any = { shop: session.shop };
    if (methodFilter) whereClause.method = methodFilter;
    if (actionFilter) whereClause.action = actionFilter;

    // Fetch logs — all display data is stored directly in the table
    const logs = await db.activityLog.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: 10
    });

    return json({ logs });
};
