import { json, type LoaderFunctionArgs } from "@remix-run/node";
import shopify from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);
    const settings = await db.settings.findUnique({
        where: { shop: session.shop },
        select: {
            currentStatus: true,
            isActive: true,
            lastRunAt: true,
            lastScanType: true,
            lastScanResults: true,
            frequency: true,
            frequencyUnit: true
        }
    });
    const latestLog = await db.activityLog.findFirst({
        where: { shop: session.shop },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
    });

    return json({ settings, latestLogId: latestLog?.id || null });
};
