import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

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
        ).then(res => res.json())
    );

    const results = await Promise.all(queries);

    const stats = {
        active: (results[0] as any).data?.productsCount?.count || 0,
        draft: (results[1] as any).data?.productsCount?.count || 0,
        archived: (results[2] as any).data?.productsCount?.count || 0,
        activeNoStock: (results[3] as any).data?.productsCount?.count || 0,
        inactiveWithStock: (results[4] as any).data?.productsCount?.count || 0,
    };

    return json({ stats });
};
