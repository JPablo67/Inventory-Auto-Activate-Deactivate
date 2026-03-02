import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import {
    Page,
    Layout,
    Card,
    Text,
    TextField,
    Button,
    BlockStack,
    InlineStack,
    IndexTable,
    Badge,
    Banner,
    Thumbnail,
    Box
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "scan") {
        const skusString = formData.get("skus") as string;
        // Split by comma, space, or newline
        const skus = skusString.split(/[\s,]+/).filter(sku => sku.trim() !== "");

        if (skus.length === 0) {
            return json({ success: false, candidates: [], error: "No valid SKUs provided" });
        }

        // Shopify GraphQL Product search by SKU (limit 250 max per query typically)
        // For large lists, we might need pagination, but let's start with a single query for simplicity
        const querySkus = skus.map(sku => `sku:${sku}`).join(" OR ");

        const query = `
            query getProductsBySkus($query: String!) {
                products(first: 250, query: $query) {
                    nodes {
                        id
                        title
                        status
                        featuredImage { url }
                        variants(first: 10) { 
                            nodes { 
                                sku 
                            } 
                        }
                    }
                }
            }
        `;

        try {
            const response = await admin.graphql(query, { variables: { query: querySkus } });
            const responseJson = await response.json();
            const nodes = (responseJson as any).data?.products?.nodes || [];

            return json({ success: true, candidates: nodes, scannedSkus: skus });
        } catch (e) {
            console.error("Failed to fetch products by SKUs:", e);
            return json({ success: false, candidates: [], error: "Failed to query Shopify API" }, { status: 500 });
        }
    }

    if (actionType === "tag") {
        const productsString = formData.get("products") as string;
        const tag = formData.get("tag") as string;
        const products = JSON.parse(productsString || "[]");

        if (!tag || tag.trim() === "") {
            return json({ success: false, error: "No tag provided" });
        }

        if (products.length === 0) {
            return json({ success: false, error: "No products to tag" });
        }

        // Extract IDs
        const productIds = products.map((p: any) => p.id);

        // Shopify tagsAdd Mutation
        const mutation = `
            mutation tagsAdd($id: ID!, $tags: [String!]!) {
                tagsAdd(id: $id, tags: $tags) {
                    node {
                        id
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;

        let successCount = 0;
        let failCount = 0;

        for (const id of productIds) {
            try {
                const response = await admin.graphql(mutation, {
                    variables: {
                        id: id,
                        tags: [tag]
                    }
                });
                const responseJson = await response.json();
                const errors = (responseJson as any).data?.tagsAdd?.userErrors || [];

                if (errors.length > 0) {
                    console.error(`Failed to add tag to ${id}:`, errors);
                    failCount++;
                } else {
                    successCount++;

                    // Log the action
                    const product = products.find((p: any) => p.id === id);
                    if (product) {
                        await db.activityLog.create({
                            data: {
                                shop: session.shop,
                                productId: product.id,
                                productTitle: product.title,
                                productSku: product.sku || "-", // We'll pass the exact matched SKU
                                method: "MANUAL",
                                action: `TAG: ${tag}`,
                            }
                        });
                    }
                }
            } catch (e) {
                console.error(`Mutation failed for ${id}:`, e);
                failCount++;
            }
        }

        return json({
            success: true,
            taggedCount: successCount,
            failedCount: failCount,
            tagAdded: tag
        });
    }

    return null;
};

export default function TagsPage() {
    const actionData = useActionData<typeof action>();
    const submit = useSubmit();
    const navigation = useNavigation();

    const isLoading = navigation.state === "submitting" || navigation.state === "loading";
    const isScanning = isLoading && navigation.formData?.get("actionType") === "scan";
    const isTagging = isLoading && navigation.formData?.get("actionType") === "tag";

    const [skuInput, setSkuInput] = useState("");
    const [tagInput, setTagInput] = useState("");
    const [scannedProducts, setScannedProducts] = useState<any[]>([]);

    useEffect(() => {
        if (actionData?.success && (actionData as any)?.candidates) {
            setScannedProducts((actionData as any).candidates);
        } else if (actionData?.success && (actionData as any)?.taggedCount !== undefined) {
            shopify.toast.show(`Successfully added tag "${(actionData as any).tagAdded}" to ${(actionData as any).taggedCount} products.`);
            // Clear the list after successful tagging
            setScannedProducts([]);
            setSkuInput("");
            setTagInput("");
        }
    }, [actionData]);

    const handleScan = () => {
        if (!skuInput.trim()) {
            shopify.toast.show("Please enter at least one SKU");
            return;
        }
        submit({ actionType: "scan", skus: skuInput }, { method: "POST" });
    };

    const handleTag = () => {
        if (!tagInput.trim()) {
            shopify.toast.show("Please enter a tag to apply");
            return;
        }
        if (scannedProducts.length === 0) {
            shopify.toast.show("No products to tag. Please scan SKUs first.");
            return;
        }

        // Map to simpler format for passing back to server
        const productsToSerialize = scannedProducts.map(p => {
            // Find first valid SKU to log
            let skuToLog = "-";
            if (p.variants?.nodes && p.variants.nodes.length > 0) {
                skuToLog = p.variants.nodes.map((v: any) => v.sku).filter(Boolean).join(", ");
            }

            return {
                id: p.id,
                title: p.title,
                sku: skuToLog
            };
        });

        submit({
            actionType: "tag",
            tag: tagInput,
            products: JSON.stringify(productsToSerialize)
        }, { method: "POST" });
    };

    return (
        <Page title="Bulk Apply Tags">
            <Layout>
                <Layout.Section>
                    <BlockStack gap="500">
                        <Card>
                            <BlockStack gap="400">
                                <Text as="h2" variant="headingMd">Identify Products</Text>
                                <Text as="p" variant="bodyMd" tone="subdued">
                                    Paste a list of SKUs separated by spaces, commas, or new lines. We will scan your store for matching products.
                                </Text>
                                <TextField
                                    label="SKU List"
                                    value={skuInput}
                                    onChange={setSkuInput}
                                    multiline={4}
                                    autoComplete="off"
                                    placeholder="SKU1, SKU2, SKU3..."
                                />
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <Button variant="primary" onClick={handleScan} loading={isScanning} disabled={isTagging}>
                                        Scan Products
                                    </Button>
                                </div>
                            </BlockStack>
                        </Card>

                        {scannedProducts.length > 0 && (
                            <Card>
                                <BlockStack gap="400">
                                    <InlineStack align="space-between" blockAlign="center">
                                        <BlockStack gap="200">
                                            <Text as="h2" variant="headingMd">Matching Products Found ({scannedProducts.length})</Text>
                                            <Text as="p" tone="subdued">Review the products below before applying a tag to all of them.</Text>
                                        </BlockStack>
                                    </InlineStack>

                                    <Box paddingBlockStart="200" paddingBlockEnd="400">
                                        <TextField
                                            label="Tag to Apply"
                                            value={tagInput}
                                            onChange={setTagInput}
                                            autoComplete="off"
                                            placeholder="e.g. Clearance, Out of Stock, Summer Sale"
                                            helpText="This exact tag will be appended to all products listed below."
                                        />
                                    </Box>

                                    <IndexTable
                                        resourceName={{ singular: 'product', plural: 'products' }}
                                        itemCount={scannedProducts.length}
                                        selectedItemsCount={0}
                                        onSelectionChange={() => { }}
                                        selectable={false}
                                        headings={[
                                            { title: 'Image' },
                                            { title: 'Product' },
                                            { title: 'SKUs found' },
                                            { title: 'Status' },
                                        ]}
                                    >
                                        {scannedProducts.map((product, index) => {
                                            const image = product.featuredImage?.url;

                                            // Extract all skus for display
                                            let skusDisplay = "-";
                                            if (product.variants?.nodes) {
                                                skusDisplay = product.variants.nodes.map((v: any) => v.sku).filter(Boolean).join(", ");
                                            }

                                            return (
                                                <IndexTable.Row id={product.id} key={product.id} position={index}>
                                                    <IndexTable.Cell>
                                                        {image ? (
                                                            <Thumbnail source={image} alt={product.title} size="small" />
                                                        ) : (
                                                            <div style={{ width: 40, height: 40, background: "#f1f1f1", borderRadius: 4 }}></div>
                                                        )}
                                                    </IndexTable.Cell>
                                                    <IndexTable.Cell>
                                                        <Text variant="bodyMd" as="span" fontWeight="bold">
                                                            {product.title}
                                                        </Text>
                                                    </IndexTable.Cell>
                                                    <IndexTable.Cell>
                                                        {skusDisplay}
                                                    </IndexTable.Cell>
                                                    <IndexTable.Cell>
                                                        <Badge tone={product.status === "ACTIVE" ? "success" : "info"}>
                                                            {product.status}
                                                        </Badge>
                                                    </IndexTable.Cell>
                                                </IndexTable.Row>
                                            );
                                        })}
                                    </IndexTable>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                        <Button variant="primary" tone="success" onClick={handleTag} loading={isTagging}>
                                            Confirm and Tag All Products
                                        </Button>
                                    </div>
                                </BlockStack>
                            </Card>
                        )}

                        {(actionData as any)?.error && (
                            <Banner tone="critical">
                                <p>{(actionData as any).error}</p>
                            </Banner>
                        )}

                        {actionData?.success === false && scannedProducts.length === 0 && !(actionData as any)?.error && (
                            <Banner tone="warning">
                                <p>No products were found matching those SKUs.</p>
                            </Banner>
                        )}
                    </BlockStack>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
