import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getCached, setCached } from "../services/cache.server";
import type { ShopifyGraphQLResponse } from "../services/inventory.server";

const STATS_TTL = 25_000; // 25s — just under the 30s client poll interval

interface ProductsCountData {
    productsCount: { count: number };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin, session } = await authenticate.admin(request);

    const cacheKey = `stats:${session.shop}`;
    const cached = getCached<Record<string, number>>(cacheKey);
    if (cached) return json({ stats: cached });

    const queries = [
        { label: "active", query: "status:active" },
        { label: "draft", query: "status:draft" },
        { label: "archived", query: "status:archived" },
        { label: "activeNoStock", query: "status:active AND inventory_total:<=0" },
        { label: "inactiveWithStock", query: "(status:draft OR status:archived) AND inventory_total:>0" }
    ].map((item) =>
        admin.graphql(
            `query getStats($query: String) {
            productsCount(query: $query, limit: null) {
              count
            }
          }`,
            { variables: { query: item.query } }
        ).then(res => res.json() as Promise<ShopifyGraphQLResponse<ProductsCountData>>)
    );

    const results = await Promise.all(queries);

    const stats = {
        active: results[0].data?.productsCount?.count || 0,
        draft: results[1].data?.productsCount?.count || 0,
        archived: results[2].data?.productsCount?.count || 0,
        activeNoStock: results[3].data?.productsCount?.count || 0,
        inactiveWithStock: results[4].data?.productsCount?.count || 0,
    };

    setCached(cacheKey, stats, STATS_TTL);
    return json({ stats });
};
