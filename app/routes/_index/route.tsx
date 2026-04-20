import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Auto Hide Out of Stock</h1>
        <p className={styles.text}>
          Automatically move sold-out products to Draft and bring them back the
          moment stock returns. Install from your Shopify admin to get started.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Auto-hide sold-out products.</strong> Set a scan frequency
            and days-inactive threshold — the app handles the rest.
          </li>
          <li>
            <strong>Auto-reactivate on restock.</strong> The moment inventory
            returns, the product flips back to Active automatically.
          </li>
          <li>
            <strong>Full audit log.</strong> Every change is tagged, logged with
            timestamp and method, and one-click reversible.
          </li>
        </ul>
      </div>
    </div>
  );
}
