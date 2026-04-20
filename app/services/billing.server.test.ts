import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
    default: {
        settings: {
            findUnique: vi.fn(),
            updateMany: vi.fn(),
        },
    },
}));

vi.mock("../shopify.server", () => ({
    ALL_PLANS: ["Starter", "Growth", "Pro", "Starter Annual", "Growth Annual", "Pro Annual"] as const,
    IS_TEST_BILLING: true,
}));

vi.mock("@sentry/remix", () => ({
    withScope: vi.fn((fn: (scope: { setTag: () => void; setContext: () => void }) => void) =>
        fn({ setTag: () => {}, setContext: () => {} })
    ),
    captureException: vi.fn(),
}));

import * as Sentry from "@sentry/remix";
import db from "../db.server";
import {
    evaluateBilling,
    isFreeShop,
    isSchedulerAllowed,
    markSubscriptionActive,
    startGracePeriod,
} from "./billing.server";

type MockedDb = {
    settings: {
        findUnique: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
    };
};
const mockedDb = db as unknown as MockedDb;

beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FREE_TIER_SHOPS;
});

describe("isFreeShop", () => {
    it("returns false when FREE_TIER_SHOPS is unset", () => {
        expect(isFreeShop("anyshop.myshopify.com")).toBe(false);
    });

    it("returns true for a shop listed in the env var", () => {
        process.env.FREE_TIER_SHOPS = "perfumes.myshopify.com";
        expect(isFreeShop("perfumes.myshopify.com")).toBe(true);
    });

    it("trims whitespace around comma-separated entries", () => {
        process.env.FREE_TIER_SHOPS = "  shop-a.myshopify.com , shop-b.myshopify.com ";
        expect(isFreeShop("shop-a.myshopify.com")).toBe(true);
        expect(isFreeShop("shop-b.myshopify.com")).toBe(true);
    });

    it("ignores empty entries produced by stray commas", () => {
        process.env.FREE_TIER_SHOPS = "shop-a.myshopify.com,,";
        expect(isFreeShop("shop-a.myshopify.com")).toBe(true);
        expect(isFreeShop("")).toBe(false);
    });

    it("is case-sensitive (Shopify shop domains are lowercase in practice)", () => {
        process.env.FREE_TIER_SHOPS = "perfumes.myshopify.com";
        expect(isFreeShop("Perfumes.myshopify.com")).toBe(false);
    });
});

describe("isSchedulerAllowed", () => {
    const now = new Date("2026-04-19T12:00:00Z");

    it("allows free shops regardless of subscriptionStatus", () => {
        process.env.FREE_TIER_SHOPS = "free.myshopify.com";
        expect(isSchedulerAllowed("free.myshopify.com", "NONE", null, now)).toBe(true);
    });

    it("allows ACTIVE shops", () => {
        expect(isSchedulerAllowed("paid.myshopify.com", "ACTIVE", null, now)).toBe(true);
    });

    it("allows GRACE shops whose window is still open", () => {
        const future = new Date("2026-04-20T12:00:00Z");
        expect(isSchedulerAllowed("paid.myshopify.com", "GRACE", future, now)).toBe(true);
    });

    it("blocks GRACE shops whose window has elapsed", () => {
        const past = new Date("2026-04-18T12:00:00Z");
        expect(isSchedulerAllowed("paid.myshopify.com", "GRACE", past, now)).toBe(false);
    });

    it("blocks GRACE with a missing timestamp (malformed state)", () => {
        expect(isSchedulerAllowed("paid.myshopify.com", "GRACE", null, now)).toBe(false);
    });

    it("blocks NONE shops (never subscribed or grace expired)", () => {
        expect(isSchedulerAllowed("paid.myshopify.com", "NONE", null, now)).toBe(false);
    });

    it("blocks unknown subscription statuses (forward compatibility)", () => {
        expect(isSchedulerAllowed("paid.myshopify.com", "UNKNOWN", null, now)).toBe(false);
    });
});

describe("evaluateBilling", () => {
    const now = new Date("2026-04-19T12:00:00Z");

    it("short-circuits for free shops without calling billing.check", async () => {
        process.env.FREE_TIER_SHOPS = "free.myshopify.com";
        const check = vi.fn();
        const gate = await evaluateBilling({ check }, "free.myshopify.com", now);
        expect(gate).toEqual({ allowed: true, reason: "free" });
        expect(check).not.toHaveBeenCalled();
        expect(mockedDb.settings.updateMany).not.toHaveBeenCalled();
    });

    it("returns active and persists ACTIVE when hasActivePayment is true", async () => {
        const check = vi.fn().mockResolvedValue({ hasActivePayment: true });
        mockedDb.settings.updateMany.mockResolvedValue({ count: 1 });

        const gate = await evaluateBilling({ check }, "paid.myshopify.com", now);

        expect(gate).toEqual({ allowed: true, reason: "active" });
        expect(mockedDb.settings.updateMany).toHaveBeenCalledWith({
            where: { shop: "paid.myshopify.com" },
            data: { subscriptionStatus: "ACTIVE", gracePeriodEndsAt: null },
        });
    });

    it("returns grace and persists GRACE when payment lapsed but window is open", async () => {
        const future = new Date("2026-04-21T12:00:00Z");
        const check = vi.fn().mockResolvedValue({ hasActivePayment: false });
        mockedDb.settings.findUnique.mockResolvedValue({ gracePeriodEndsAt: future });
        mockedDb.settings.updateMany.mockResolvedValue({ count: 1 });

        const gate = await evaluateBilling({ check }, "lapsed.myshopify.com", now);

        expect(gate).toEqual({ allowed: true, reason: "grace", gracePeriodEndsAt: future });
        expect(mockedDb.settings.updateMany).toHaveBeenCalledWith({
            where: { shop: "lapsed.myshopify.com" },
            data: { subscriptionStatus: "GRACE", gracePeriodEndsAt: future },
        });
    });

    it("returns no-subscription and persists NONE when no grace timestamp exists", async () => {
        const check = vi.fn().mockResolvedValue({ hasActivePayment: false });
        mockedDb.settings.findUnique.mockResolvedValue({ gracePeriodEndsAt: null });
        mockedDb.settings.updateMany.mockResolvedValue({ count: 1 });

        const gate = await evaluateBilling({ check }, "fresh.myshopify.com", now);

        expect(gate).toEqual({ allowed: false, reason: "no-subscription" });
        expect(mockedDb.settings.updateMany).toHaveBeenCalledWith({
            where: { shop: "fresh.myshopify.com" },
            data: { subscriptionStatus: "NONE", gracePeriodEndsAt: null },
        });
    });

    it("returns no-subscription when the settings row doesn't exist", async () => {
        const check = vi.fn().mockResolvedValue({ hasActivePayment: false });
        mockedDb.settings.findUnique.mockResolvedValue(null);
        mockedDb.settings.updateMany.mockResolvedValue({ count: 0 });

        const gate = await evaluateBilling({ check }, "ghost.myshopify.com", now);

        expect(gate).toEqual({ allowed: false, reason: "no-subscription" });
    });

    it("returns grace-expired and demotes to NONE when the window has elapsed", async () => {
        const past = new Date("2026-04-18T12:00:00Z");
        const check = vi.fn().mockResolvedValue({ hasActivePayment: false });
        mockedDb.settings.findUnique.mockResolvedValue({ gracePeriodEndsAt: past });
        mockedDb.settings.updateMany.mockResolvedValue({ count: 1 });

        const gate = await evaluateBilling({ check }, "expired.myshopify.com", now);

        expect(gate).toEqual({ allowed: false, reason: "grace-expired" });
        expect(mockedDb.settings.updateMany).toHaveBeenCalledWith({
            where: { shop: "expired.myshopify.com" },
            data: { subscriptionStatus: "NONE", gracePeriodEndsAt: null },
        });
    });

    describe("billing endpoint outage (fail-open)", () => {
        it("logs to Sentry and falls back to persisted ACTIVE state", async () => {
            const error = new Error("Shopify 503");
            const check = vi.fn().mockRejectedValue(error);
            mockedDb.settings.findUnique.mockResolvedValue({
                subscriptionStatus: "ACTIVE",
                gracePeriodEndsAt: null,
            });

            const gate = await evaluateBilling({ check }, "paid.myshopify.com", now);

            expect(gate).toEqual({ allowed: true, reason: "active" });
            expect(Sentry.captureException).toHaveBeenCalledWith(error);
            // No ACTIVE persistence on failure — we can't trust the signal.
            expect(mockedDb.settings.updateMany).not.toHaveBeenCalled();
        });

        it("falls back to persisted GRACE when the window is still open", async () => {
            const future = new Date("2026-04-21T12:00:00Z");
            const check = vi.fn().mockRejectedValue(new Error("Shopify 503"));
            mockedDb.settings.findUnique.mockResolvedValue({
                subscriptionStatus: "GRACE",
                gracePeriodEndsAt: future,
            });

            const gate = await evaluateBilling({ check }, "grace.myshopify.com", now);

            expect(gate).toEqual({
                allowed: true,
                reason: "grace",
                gracePeriodEndsAt: future,
            });
        });

        it("fails open even when persisted state is NONE (don't lock out new installs)", async () => {
            const check = vi.fn().mockRejectedValue(new Error("Shopify 503"));
            mockedDb.settings.findUnique.mockResolvedValue({
                subscriptionStatus: "NONE",
                gracePeriodEndsAt: null,
            });

            const gate = await evaluateBilling({ check }, "fresh.myshopify.com", now);

            expect(gate.allowed).toBe(true);
        });

        it("fails open when there is no settings row at all", async () => {
            const check = vi.fn().mockRejectedValue(new Error("Shopify 503"));
            mockedDb.settings.findUnique.mockResolvedValue(null);

            const gate = await evaluateBilling({ check }, "unknown.myshopify.com", now);

            expect(gate.allowed).toBe(true);
        });

        it("demotes persisted GRACE to fail-open-active when the window has elapsed", async () => {
            const past = new Date("2026-04-18T12:00:00Z");
            const check = vi.fn().mockRejectedValue(new Error("Shopify 503"));
            mockedDb.settings.findUnique.mockResolvedValue({
                subscriptionStatus: "GRACE",
                gracePeriodEndsAt: past,
            });

            const gate = await evaluateBilling({ check }, "stale.myshopify.com", now);

            // Stale grace doesn't re-gate the merchant during an outage; fail open.
            expect(gate).toEqual({ allowed: true, reason: "active" });
        });
    });
});

describe("startGracePeriod", () => {
    const now = new Date("2026-04-19T12:00:00Z");
    const expectedEnds = new Date("2026-04-22T12:00:00Z"); // now + 3 days

    it("writes GRACE + timestamp and returns the end date on the ACTIVE→GRACE transition", async () => {
        mockedDb.settings.updateMany.mockResolvedValue({ count: 1 });

        const ends = await startGracePeriod("shop.myshopify.com", now);

        expect(ends).toEqual(expectedEnds);
        expect(mockedDb.settings.updateMany).toHaveBeenCalledWith({
            where: { shop: "shop.myshopify.com", subscriptionStatus: { not: "GRACE" } },
            data: { subscriptionStatus: "GRACE", gracePeriodEndsAt: expectedEnds },
        });
    });

    it("returns null when the shop is already in GRACE (duplicate webhook delivery)", async () => {
        mockedDb.settings.updateMany.mockResolvedValue({ count: 0 });

        const ends = await startGracePeriod("shop.myshopify.com", now);

        expect(ends).toBeNull();
    });

    it("returns null when no settings row exists (uninstalled shop)", async () => {
        mockedDb.settings.updateMany.mockResolvedValue({ count: 0 });

        const ends = await startGracePeriod("ghost.myshopify.com", now);

        expect(ends).toBeNull();
    });
});

describe("markSubscriptionActive", () => {
    it("writes ACTIVE and clears any grace timestamp", async () => {
        mockedDb.settings.updateMany.mockResolvedValue({ count: 1 });

        await markSubscriptionActive("shop.myshopify.com");

        expect(mockedDb.settings.updateMany).toHaveBeenCalledWith({
            where: { shop: "shop.myshopify.com" },
            data: { subscriptionStatus: "ACTIVE", gracePeriodEndsAt: null },
        });
    });
});
