import { json } from "@remix-run/node";
import db from "../db.server";

// Public health probe used by Docker HEALTHCHECK and upstream proxies (Cloudflare).
// Verifies the process is up AND the DB is reachable — a hung event loop or a
// dead connection pool both fail this check, which is what we want.
export const loader = async () => {
    try {
        await db.$queryRaw`SELECT 1`;
        return json({ status: "ok" }, { status: 200 });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json({ status: "error", error: message }, { status: 503 });
    }
};
