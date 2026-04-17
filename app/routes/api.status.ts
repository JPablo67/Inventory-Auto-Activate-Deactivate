import { json, type LoaderFunctionArgs } from "@remix-run/node";
import shopify from "../shopify.server";
import db from "../db.server";
import { getCached, setCached } from "../services/cache.server";

const STATUS_TTL = 2_000; // 2s — polls at 3s when running, 15s when idle

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { session } = await shopify.authenticate.admin(request);

    const cacheKey = `status:${session.shop}`;
    const cached = getCached<object>(cacheKey);
    if (cached) return json(cached);

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

    const payload = { settings, latestLogId: latestLog?.id || null };
    setCached(cacheKey, payload, STATUS_TTL);
    return json(payload);
};
