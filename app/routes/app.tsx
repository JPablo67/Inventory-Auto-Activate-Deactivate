import { redirect, type HeadersFunction, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { URL as NodeURL } from "url";

import { authenticate } from "../shopify.server";
import { evaluateBilling } from "../services/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const url = new NodeURL(request.url);

  // Don't gate the pricing page itself, otherwise users can't pay to unlock.
  const isPricingRoute = url.pathname.startsWith("/app/pricing");

  let gracePeriodEndsAt: string | null = null;

  if (!isPricingRoute) {
    const gate = await evaluateBilling(billing, session.shop);
    if (!gate.allowed) {
      throw redirect("/app/pricing");
    }
    if (gate.reason === "grace" && gate.gracePeriodEndsAt) {
      gracePeriodEndsAt = gate.gracePeriodEndsAt.toISOString();
    }
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "", gracePeriodEndsAt };
};

export default function App() {
  const { apiKey, gracePeriodEndsAt } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Auto Hide Out of Stock
        </Link>
        <Link to="/app/dashboard">Homepage</Link>
        <Link to="/app/activity">Activity Log</Link>
        <Link to="/app/settings">Auto-Deactivate</Link>
        <Link to="/app/manual">Manual Scan</Link>
        <Link to="/app/tags">Bulk Tags</Link>
        <Link to="/app/pricing">Plan & Billing</Link>
      </NavMenu>
      {gracePeriodEndsAt && (
        <Banner
          tone="warning"
          title="Subscription needs attention"
          action={{ content: "Choose a plan", url: "/app/pricing" }}
        >
          <p>
            Your subscription has lapsed. Access will be suspended on{" "}
            {new Date(gracePeriodEndsAt).toLocaleString()}.
          </p>
        </Banner>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
