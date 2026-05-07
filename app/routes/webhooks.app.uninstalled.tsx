import type { ActionFunctionArgs } from "@remix-run/node";
import * as Sentry from "@sentry/remix";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  Sentry.getCurrentScope().setTag("shop", shop);
  Sentry.getCurrentScope().setTag("webhook_topic", topic);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // We unconditionally delete all sessions, settings, and logs associated with this shop to comply with GDPR/Shopify policies.
  await db.session.deleteMany({ where: { shop } });
  await db.settings.deleteMany({ where: { shop } });
  await db.activityLog.deleteMany({ where: { shop } });

  return new Response("OK", { status: 200 });
};
