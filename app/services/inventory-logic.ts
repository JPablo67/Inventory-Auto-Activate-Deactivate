// Pure logic + types for inventory deactivation decisions.
// No imports from shopify.server / db.server so tests can import this
// module without pulling in runtime side effects.

export interface ProductCandidate {
  id: string;
  title: string;
  handle: string;
  featuredImage: { url: string } | null;
  sku: string;
  daysInactive: number;
}

export interface ZeroStockVariantNode {
  sku?: string | null;
  inventoryItem?: {
    tracked?: boolean | null;
    inventoryLevels?: {
      edges?: Array<{
        node: {
          updatedAt: string;
          quantities: Array<{ name?: string; quantity: number }>;
        };
      }>;
    };
  } | null;
}

export interface ZeroStockProductNode {
  id: string;
  title: string;
  handle?: string;
  productType?: string | null;
  featuredImage: { url: string } | null;
  variants: { nodes: ZeroStockVariantNode[] };
  daysInactive?: number;
}

export interface ShopifyGraphQLResponse<T> {
  data?: T;
}

export interface ZeroStockProductsData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ZeroStockProductNode[];
  };
}

export function isDeactivationCandidate(
  product: ZeroStockProductNode,
  cutoffMs: number,
  nowMs: number = Date.now(),
): { candidate: boolean; daysInactive: number } {
  // EXCLUSION: Gift Cards (covers "Gift Card", "giftcard", "Gift Cards")
  if (product.productType) {
    const type = product.productType.toLowerCase();
    if (type.includes("gift card") || type === "giftcard") {
      return { candidate: false, daysInactive: 0 };
    }
  }

  let mostRecentUpdate = 0;
  let allVariantsZero = true;

  for (const variant of product.variants.nodes) {
    // EXCLUSION: untracked inventory is always considered active
    if (variant.inventoryItem?.tracked === false) {
      allVariantsZero = false;
      break;
    }

    const level = variant.inventoryItem?.inventoryLevels?.edges?.[0]?.node;
    if (!level) continue;

    const available =
      level.quantities.find((q) => q.name === "available")?.quantity ?? 0;

    if (available > 0) {
      allVariantsZero = false;
      break;
    }

    const updatedAt = new Date(level.updatedAt).getTime();
    if (updatedAt > mostRecentUpdate) {
      mostRecentUpdate = updatedAt;
    }
  }

  if (!allVariantsZero || mostRecentUpdate === 0) {
    return { candidate: false, daysInactive: 0 };
  }

  const diff = nowMs - mostRecentUpdate;
  if (diff <= cutoffMs) {
    return { candidate: false, daysInactive: 0 };
  }

  return {
    candidate: true,
    daysInactive: Math.floor(diff / (1000 * 60 * 60 * 24)),
  };
}
