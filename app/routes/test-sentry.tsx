import type { LoaderFunctionArgs } from "@remix-run/node";

// TEMPORARY — verifies Sentry wiring end-to-end. Delete after the smoke test.
const SECRET = "sentry-wiring-check-2026-04-19";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== SECRET) {
        return new Response("Not Found", { status: 404 });
    }
    throw new Error("Sentry wiring smoke test — safe to ignore");
};
