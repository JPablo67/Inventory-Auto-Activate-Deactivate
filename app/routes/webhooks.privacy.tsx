import type { ActionFunctionArgs } from "@remix-run/node";
import * as Sentry from "@sentry/remix";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    // HMAC failures throw a Response; Remix forwards them as 401 — that's correct.
    // We do not store customer PII, so there is no per-topic processing to do.
    // Anything that throws below the auth step must NOT 5xx — Shopify will flag the app.
    const { topic, shop } = await authenticate.webhook(request);

    try {
        console.log(`[Privacy Webhook] Received ${topic} for shop ${shop}`);
    } catch (error) {
        Sentry.captureException(error, { tags: { shop, webhook_topic: topic } });
    }

    return new Response("OK", { status: 200 });
};
