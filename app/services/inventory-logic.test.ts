import { describe, expect, it } from "vitest";
import {
  isDeactivationCandidate,
  type ZeroStockProductNode,
  type ZeroStockVariantNode,
} from "./inventory-logic";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-04-15T12:00:00Z").getTime();

function variant(opts: {
  available?: number;
  daysAgo?: number;
  tracked?: boolean | null;
  hasLevel?: boolean;
  sku?: string | null;
} = {}): ZeroStockVariantNode {
  const {
    available = 0,
    daysAgo = 100,
    tracked = true,
    hasLevel = true,
    sku = "SKU-1",
  } = opts;
  if (!hasLevel) {
    return { sku, inventoryItem: { tracked, inventoryLevels: { edges: [] } } };
  }
  return {
    sku,
    inventoryItem: {
      tracked,
      inventoryLevels: {
        edges: [
          {
            node: {
              updatedAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
              quantities: [{ name: "available", quantity: available }],
            },
          },
        ],
      },
    },
  };
}

function product(overrides: Partial<ZeroStockProductNode> = {}): ZeroStockProductNode {
  return {
    id: "gid://shopify/Product/1",
    title: "Test Product",
    productType: "T-Shirt",
    featuredImage: null,
    variants: { nodes: [variant()] },
    ...overrides,
  };
}

describe("isDeactivationCandidate", () => {
  const cutoff = 90 * DAY_MS;

  it("returns true when all variants are zero and last update is older than cutoff", () => {
    const result = isDeactivationCandidate(
      product({ variants: { nodes: [variant({ available: 0, daysAgo: 100 })] } }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(true);
    expect(result.daysInactive).toBe(100);
  });

  it("returns false when last update is exactly at the cutoff boundary (inclusive)", () => {
    // diff === cutoffMs should NOT qualify (implementation uses `diff <= cutoffMs`)
    const result = isDeactivationCandidate(
      product({ variants: { nodes: [variant({ available: 0, daysAgo: 90 })] } }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
    expect(result.daysInactive).toBe(0);
  });

  it("returns false when last update is newer than cutoff", () => {
    const result = isDeactivationCandidate(
      product({ variants: { nodes: [variant({ available: 0, daysAgo: 30 })] } }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("returns false if any variant has available stock", () => {
    const result = isDeactivationCandidate(
      product({
        variants: {
          nodes: [
            variant({ available: 0, daysAgo: 200 }),
            variant({ available: 5, daysAgo: 200 }),
          ],
        },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("excludes gift cards (productType 'Gift Card')", () => {
    const result = isDeactivationCandidate(
      product({
        productType: "Gift Card",
        variants: { nodes: [variant({ available: 0, daysAgo: 200 })] },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("excludes gift cards (productType 'Gift Cards' — plural)", () => {
    const result = isDeactivationCandidate(
      product({
        productType: "Gift Cards",
        variants: { nodes: [variant({ available: 0, daysAgo: 200 })] },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("excludes gift cards (productType 'giftcard' — no space, lowercase)", () => {
    const result = isDeactivationCandidate(
      product({
        productType: "giftcard",
        variants: { nodes: [variant({ available: 0, daysAgo: 200 })] },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("excludes gift cards regardless of casing ('GIFT CARD')", () => {
    const result = isDeactivationCandidate(
      product({
        productType: "GIFT CARD",
        variants: { nodes: [variant({ available: 0, daysAgo: 200 })] },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("treats untracked variants as active (excludes product from deactivation)", () => {
    const result = isDeactivationCandidate(
      product({
        variants: {
          nodes: [
            variant({ tracked: false, daysAgo: 200 }),
          ],
        },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
  });

  it("returns false when no variant has any inventory level data", () => {
    const result = isDeactivationCandidate(
      product({
        variants: { nodes: [variant({ hasLevel: false })] },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(false);
    expect(result.daysInactive).toBe(0);
  });

  it("uses the most recent variant update when computing daysInactive", () => {
    const result = isDeactivationCandidate(
      product({
        variants: {
          nodes: [
            variant({ available: 0, daysAgo: 300 }),
            variant({ available: 0, daysAgo: 120 }),
          ],
        },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(true);
    expect(result.daysInactive).toBe(120);
  });

  it("floors fractional days correctly", () => {
    // 100.7 days inactive should report 100
    const result = isDeactivationCandidate(
      product({
        variants: {
          nodes: [
            {
              sku: "X",
              inventoryItem: {
                tracked: true,
                inventoryLevels: {
                  edges: [
                    {
                      node: {
                        updatedAt: new Date(NOW - (100 * DAY_MS + 17 * 60 * 60 * 1000)).toISOString(),
                        quantities: [{ name: "available", quantity: 0 }],
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(true);
    expect(result.daysInactive).toBe(100);
  });

  it("handles missing productType gracefully", () => {
    const result = isDeactivationCandidate(
      product({
        productType: null,
        variants: { nodes: [variant({ available: 0, daysAgo: 200 })] },
      }),
      cutoff,
      NOW,
    );
    expect(result.candidate).toBe(true);
  });
});
