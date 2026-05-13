// The merchant-facing Managed Pricing picker lives on the admin origin, so
// reaching it from inside our iframe always requires a top-level navigation.
// APP_HANDLE is the URL slug set in Partner Dashboard → Distribution → App
// listing → URL handle; override via env if it ever changes.
const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "auto-hide-out-of-stock-1";

export function buildManagedPricingUrl(shop: string): string {
    const shopHandle = shop.replace(/\.myshopify\.com$/, "");
    return `https://admin.shopify.com/store/${shopHandle}/charges/${APP_HANDLE}/pricing_plans`;
}
