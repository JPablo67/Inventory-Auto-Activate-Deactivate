import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  BillingInterval,
  BillingReplacementBehavior,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export { STARTER_PLAN, GROWTH_PLAN, PRO_PLAN, STARTER_PLAN_ANNUAL, GROWTH_PLAN_ANNUAL, PRO_PLAN_ANNUAL, ALL_PLANS, IS_TEST_BILLING } from "./billing.constants";
import { STARTER_PLAN, GROWTH_PLAN, PRO_PLAN, STARTER_PLAN_ANNUAL, GROWTH_PLAN_ANNUAL, PRO_PLAN_ANNUAL } from "./billing.constants";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [STARTER_PLAN]: {
      lineItems: [
        {
          amount: 4.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 15,
      replacementBehavior: BillingReplacementBehavior.ApplyOnNextBillingCycle,
    },
    [GROWTH_PLAN]: {
      lineItems: [
        {
          amount: 6.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 15,
      replacementBehavior: BillingReplacementBehavior.ApplyOnNextBillingCycle,
    },
    [PRO_PLAN]: {
      lineItems: [
        {
          amount: 9.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: 15,
      replacementBehavior: BillingReplacementBehavior.ApplyOnNextBillingCycle,
    },
    [STARTER_PLAN_ANNUAL]: {
      lineItems: [
        {
          amount: 44.99,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 15,
      replacementBehavior: BillingReplacementBehavior.ApplyOnNextBillingCycle,
    },
    [GROWTH_PLAN_ANNUAL]: {
      lineItems: [
        {
          amount: 59.99,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 15,
      replacementBehavior: BillingReplacementBehavior.ApplyOnNextBillingCycle,
    },
    [PRO_PLAN_ANNUAL]: {
      lineItems: [
        {
          amount: 89.99,
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
      trialDays: 15,
      replacementBehavior: BillingReplacementBehavior.ApplyOnNextBillingCycle,
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
