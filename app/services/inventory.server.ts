import shopify from "../shopify.server";

const DEACTIVATION_TAG = "auto-changed-draft";


export interface ProductCandidate {
  id: string;
  title: string;
  handle: string;
  featuredImage: { url: string } | null;
  sku: string;
  daysInactive: number;
}

export async function scanOldProducts(request: Request, minDaysInactive: number = 90): Promise<ProductCandidate[]> {
  const { admin } = await shopify.authenticate.admin(request);
  const cutoffMs = minDaysInactive * 24 * 60 * 60 * 1000;

  // 1. Fetch all active products with <= 0 total inventory
  const query = `
    query getZeroStockProducts($cursor: String) {
      products(first: 50, query: "status:active AND inventory_total:<=0", after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          handle
          productType
          featuredImage {
            url
          }
          variants(first: 100) {
            nodes {
              sku
              inventoryItem {
                tracked
                inventoryLevels(first: 1) {
                  edges {
                    node {
                      updatedAt
                      quantities(names: ["available"]) {
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let candidates: ProductCandidate[] = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const response: any = await admin.graphql(query, { variables: { cursor } });
    const responseJson: any = await response.json();

    // Safety check for data
    if (!responseJson.data?.products) {
      console.error("Failed to fetch products", responseJson);
      break;
    }

    const { nodes, pageInfo } = responseJson.data.products;

    for (const product of nodes) {
      // console.log(`[Scanner] Checking ${product.title} (Type: ${product.productType})`);

      // EXCLUSION: Skip Gift Cards
      // Covers: "Gift Card", "giftcard", "Gift Cards"
      if (product.productType) {
        const type = product.productType.toLowerCase();
        if (type.includes("gift card") || type === "giftcard") {
          // console.log(`[Scanner] Skipping Gift Card: ${product.title}`);
          continue;
        }
      }

      // Check if ALL variants are "old" logic

      let mostRecentUpdate = 0;
      let allVariantsZero = true;

      for (const variant of product.variants.nodes) {
        // EXCLUSION: Inventory Not Tracked
        // If tracked is false, we assume it is always available/active (not subject to deactivation)
        if (variant.inventoryItem?.tracked === false) {
          allVariantsZero = false;
          break;
        }

        const level = variant.inventoryItem?.inventoryLevels?.edges?.[0]?.node;
        if (!level) continue;

        const available = level.quantities.find((q: any) => q.name === "available")?.quantity || 0;

        // Double check it's actually 0 
        if (available > 0) {
          allVariantsZero = false;
          break;
        }

        const updatedAt = new Date(level.updatedAt).getTime();
        if (updatedAt > mostRecentUpdate) {
          mostRecentUpdate = updatedAt;
        }
      }

      if (allVariantsZero && mostRecentUpdate > 0) {
        const now = Date.now();
        const diff = now - mostRecentUpdate;

        if (diff > cutoffMs) {
          candidates.push({
            id: product.id,
            title: product.title,
            handle: product.handle,
            featuredImage: product.featuredImage,
            sku: product.variants.nodes[0]?.sku || "",
            daysInactive: Math.floor(diff / (1000 * 60 * 60 * 24))
          });
        }
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

  }

  return candidates;
}

export async function deactivateProducts(request: Request, productIds: string[]) {
  const { admin } = await shopify.authenticate.admin(request);

  const mutation = `
    mutation deactivateProduct($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      productChangeStatus(productId: $id, status: DRAFT) { userErrors { field message } }
    }
  `;

  // Process in parallel batches of 4 to respect Shopify rate limits
  const BATCH_SIZE = 4;
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const batch = productIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((id) =>
        admin.graphql(mutation, { variables: { id, tags: [DEACTIVATION_TAG] } })
      )
    );
  }
}

export async function getProductsByStatus(request: Request, status: string, cursor?: string | null) {
  const { admin } = await shopify.authenticate.admin(request);

  let queryString = `status:${status}`;
  if (status === 'activeNoStock') {
    queryString = "status:active AND inventory_total:<=0";
  } else if (status === 'inactiveWithStock') {
    queryString = "(status:draft OR status:archived) AND inventory_total:>0";
  }

  const query = `
    query getProducts($query: String!, $cursor: String) {
      products(first: 50, query: $query, after: $cursor) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          endCursor
          startCursor
        }
        nodes {
          id
          title
          handle
          status
          totalInventory
          featuredImage {
            url
          }
          updatedAt
          variants(first: 1) {
            nodes {
              sku
            }
          }
        }
      }
    }
  `;

  const response = await admin.graphql(query, { variables: { query: queryString, cursor: cursor || null } });
  const responseJson: any = await response.json();
  const products = responseJson.data?.products;

  return {
    nodes: products?.nodes || [],
    pageInfo: products?.pageInfo || { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
  };
}
