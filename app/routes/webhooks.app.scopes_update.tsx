import type { ActionFunctionArgs } from "@remix-run/node";
import * as Sentry from "@sentry/remix";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    Sentry.getCurrentScope().setTag("shop", shop);
    Sentry.getCurrentScope().setTag("webhook_topic", topic);

    const current = Array.isArray((payload as { current?: unknown }).current)
        ? ((payload as { current: string[] }).current)
        : [];

    if (session) {
        try {
            await db.session.update({
                where: { id: session.id },
                data: { scope: current.join(",") },
            });
        } catch (err) {
            Sentry.captureException(err, { tags: { shop, webhook_topic: topic } });
        }
    }
    return new Response("OK", { status: 200 });
};
