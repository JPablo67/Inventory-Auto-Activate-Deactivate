import { useEffect } from "react";
import { type HeadersFunction, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Page,
  Spinner,
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
  process.env.SHOPIFY_APP_HANDLE || "auto-hide-out-of-stock-1";

function buildManagedPricingUrl(shop: string): string {
  const shopHandle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${shopHandle}/charges/${APP_HANDLE}/pricing_plans`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const gate = await evaluateBilling(billing, session.shop);

  const apiKey = process.env.SHOPIFY_API_KEY || "";

  if (!gate.allowed) {
    // Diagnostic: list every subscription on this shop so we can see why
    // billing.check returned false. Includes status (ACTIVE/PENDING/etc.)
    // and the actual plan name, which together explain plan-name mismatches
    // and unapproved-charge cases. Wrap so a slow query never blocks the
    // redirect to the plan picker. Remove once we're confident in the gate.
    admin
      .graphql(
        `{
          currentAppInstallation {
            activeSubscriptions { id name status test }
            allSubscriptions(first: 10) {
              edges { node { id name status test createdAt } }
            }
          }
        }`
      )
      .then(async (res) => {
        const data = await res.json();
        console.log(
          "[Billing diag]",
          session.shop,
          JSON.stringify(data.data?.currentAppInstallation ?? data, null, 2)
        );
      })
      .catch((err: unknown) => {
        console.log("[Billing diag] failed:", err);
      });

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

  // No active subscription → jump straight to Shopify's hosted plan picker.
  // Server-side redirect() would just load admin.shopify.com inside our iframe
  // (blocked by X-Frame-Options), so the navigation has to happen client-side
  // via window.top to escape the iframe.
  useEffect(() => {
    if (needsSubscription && typeof window !== "undefined" && window.top) {
      window.top.location.href = managedPricingUrl;
    }
  }, [needsSubscription, managedPricingUrl]);

  if (needsSubscription) {
    return (
      <AppProvider isEmbeddedApp apiKey={apiKey}>
        <Page>
          <Card>
            <BlockStack gap="400" inlineAlign="center">
              <Spinner accessibilityLabel="Redirecting to plan selection" size="large" />
              <Text as="p" tone="subdued">
                Redirecting you to plan selection…
              </Text>
              <noscript>
                <form method="get" action={managedPricingUrl} target="_top">
                  <Button submit variant="primary">
                    Continue to plan selection
                  </Button>
                </form>
              </noscript>
            </BlockStack>
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
            <form method="get" action={managedPricingUrl} target="_top">
              <Button submit>Choose a plan</Button>
            </form>
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
