import { type HeadersFunction, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  EmptyState,
  Page,
  Text,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { evaluateBilling } from "../services/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// Managed Pricing: when the shop has no active subscription we send the
// merchant to Shopify's hosted plan picker. The page lives under the admin
// origin so the only way to reach it from inside our iframe is a top-level
// navigation. We build the URL from the shop handle + the app handle (set
// in Partner Dashboard → Distribution → App listing → URL handle).
const APP_HANDLE =
  process.env.SHOPIFY_APP_HANDLE || "auto-hide-out-of-stock";

function buildManagedPricingUrl(shop: string): string {
  const shopHandle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${shopHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const gate = await evaluateBilling(billing, session.shop);

  const apiKey = process.env.SHOPIFY_API_KEY || "";

  if (!gate.allowed) {
    return {
      apiKey,
      needsSubscription: true as const,
      gracePeriodEndsAt: null,
      managedPricingUrl: buildManagedPricingUrl(session.shop),
    };
  }

  return {
    apiKey,
    needsSubscription: false as const,
    gracePeriodEndsAt:
      gate.reason === "grace" && gate.gracePeriodEndsAt
        ? gate.gracePeriodEndsAt.toISOString()
        : null,
    managedPricingUrl: buildManagedPricingUrl(session.shop),
  };
};

export default function App() {
  const { apiKey, needsSubscription, gracePeriodEndsAt, managedPricingUrl } =
    useLoaderData<typeof loader>();

  if (needsSubscription) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <Page>
          <Card>
            <EmptyState
              heading="Choose a plan to get started"
              image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
            >
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd">
                  Auto Hide Out of Stock needs an active subscription. Pick a
                  plan to start your 15-day free trial — cancel anytime.
                </Text>
                <Form method="get" action={managedPricingUrl} target="_top">
                  <Button submit variant="primary">
                    View pricing plans
                  </Button>
                </Form>
              </BlockStack>
            </EmptyState>
          </Card>
        </Page>
      </AppProvider>
    );
  }

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
      </NavMenu>
      {gracePeriodEndsAt && (
        <Banner tone="warning" title="Subscription needs attention">
          <BlockStack gap="200">
            <Text as="p">
              Your subscription has lapsed. Access will be suspended on{" "}
              {new Date(gracePeriodEndsAt).toLocaleString()}.
            </Text>
            <Form method="get" action={managedPricingUrl} target="_top">
              <Button submit>Choose a plan</Button>
            </Form>
          </BlockStack>
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
