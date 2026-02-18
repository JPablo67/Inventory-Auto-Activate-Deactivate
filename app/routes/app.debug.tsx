
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

export const loader = async () => {
    return json({
        apiKey: process.env.SHOPIFY_API_KEY,
        appUrl: process.env.SHOPIFY_APP_URL,
        scopes: process.env.SCOPES,
        nodeEnv: process.env.NODE_ENV,
    });
};

export default function Debug() {
    const data = useLoaderData<typeof loader>();
    return (
        <div style={{ padding: "20px", fontFamily: "system-ui" }}>
            <h1>Debug Info</h1>
            <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
    );
}
