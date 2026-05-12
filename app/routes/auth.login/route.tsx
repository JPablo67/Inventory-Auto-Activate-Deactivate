import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import * as Sentry from "@sentry/remix";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

// We currently land on /auth/login whenever the embedded-auth path can't
// establish a session — including the reviewer's first-install flow. Capture
// enough request context to figure out *why* the framework chose this route
// instead of bouncing to OAuth. Remove once root cause is fixed.
function captureAuthLoginContext(request: Request, phase: "loader" | "action") {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const headers = {
    referer: request.headers.get("referer"),
    host: request.headers.get("host"),
    "x-forwarded-host": request.headers.get("x-forwarded-host"),
    "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
    "user-agent": request.headers.get("user-agent"),
    "sec-fetch-dest": request.headers.get("sec-fetch-dest"),
    "sec-fetch-mode": request.headers.get("sec-fetch-mode"),
    "sec-fetch-site": request.headers.get("sec-fetch-site"),
    cookie: request.headers.get("cookie") ? "<present>" : null,
    authorization: request.headers.get("authorization") ? "<present>" : null,
  };

  Sentry.captureMessage(`auth.login ${phase} reached`, {
    level: "info",
    tags: {
      phase,
      shop: params.shop ?? "none",
      embedded: params.embedded ?? "none",
      has_host: params.host ? "yes" : "no",
      has_id_token: params.id_token ? "yes" : "no",
    },
    extra: { url: request.url, method: request.method, params, headers },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  captureAuthLoginContext(request, "loader");
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  captureAuthLoginContext(request, "action");
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <Form method="post" action="/auth/login" target="_top">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="off"
                error={errors?.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
