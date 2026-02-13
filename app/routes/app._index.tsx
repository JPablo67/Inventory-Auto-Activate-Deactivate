import { useEffect, useState, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation, useSearchParams, Link as RemixLink, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
  Banner,
  IndexTable,
  Badge,
  useIndexResourceState,
  Thumbnail,
  TextField,
  Select,
  Checkbox,
  ProgressBar,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { scanOldProducts, deactivateProducts, getProductsByStatus } from "../services/inventory.server";
import db from "../db.server";

// Define Settings Interface
interface Settings {
  isActive: boolean;
  frequency: number;
  frequencyUnit: string;
  lastRunAt: string | null;
  minDaysInactive: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view"); // 'active', 'draft', 'archived'

  // 1. Fetch Metrics (Always needed for the top bar if we want it persistent, or just for dashboard)
  let stats = { active: 0, draft: 0, archived: 0 };
  let productList = [];

  if (!view) {
    const queries = ["active", "draft", "archived"].map((status) =>
      admin.graphql(
        `query CountProducts($query: String) {
            productsCount(query: $query) {
              count
            }
          }`,
        { variables: { query: `status:${status}` } }
      ).then(res => res.json())
    );

    const [activeRes, draftRes, archivedRes] = await Promise.all(queries);

    stats = {
      active: (activeRes as any).data?.productsCount?.count || 0,
      draft: (draftRes as any).data?.productsCount?.count || 0,
      archived: (archivedRes as any).data?.productsCount?.count || 0,
    };
  } else {
    // If we are in a view, fetch the products
    productList = await getProductsByStatus(request, view);
  }

  // 2. Fetch Activity Log
  const logs = await db.activityLog.findMany({
    where: { shop: session.shop },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  // Enrich logs with Shopify Product Data (Image, SKU, Current Status)
  const logProductIds = [...new Set(logs.map((l) => l.productId).filter((id) => id))];
  const logProductsMap: Record<string, any> = {};

  if (logProductIds.length > 0) {
    const query = `
      query getLogProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            status
            featuredImage { url }
            variants(first: 1) { nodes { sku } }
          }
        }
      }
    `;

    try {
      const response = await admin.graphql(query, { variables: { ids: logProductIds } });
      const responseJson = await response.json();
      const nodes = (responseJson as any).data?.nodes || [];

      nodes.forEach((node: any) => {
        if (node && node.id) {
          logProductsMap[node.id] = node;
        }
      });
    } catch (e) {
      console.error("Failed to fetch details for log products:", e);
    }
  }

  const enrichedLogs = logs.map((log) => ({
    ...log,
    productDetails: logProductsMap[log.productId] || null,
  }));

  // 3. Fetch Settings
  const settings = await db.settings.findUnique({ where: { shop: session.shop } });

  return { stats, logs: enrichedLogs, productList, view, settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session: settingsSession } = await authenticate.admin(request); // Ensure auth
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "scan") {
    const days = parseInt(formData.get("days") as string || "90", 10);
    const candidates = await scanOldProducts(request, days);

    // Update Last Scan info for Manual Scan
    await db.settings.upsert({
      where: { shop: settingsSession.shop },
      update: {
        lastRunAt: new Date(),
        lastScanType: 'MANUAL',
        lastScanResults: JSON.stringify(candidates)
      },
      create: {
        shop: settingsSession.shop,
        isActive: false,
        lastRunAt: new Date(),
        lastScanType: 'MANUAL',
        lastScanResults: JSON.stringify(candidates)
      }
    });

    return { candidates, success: true };
  }

  if (actionType === "deactivate") {
    const productsString = formData.get("selectedProducts") as string;
    const products = JSON.parse(productsString || "[]");

    // Extract IDs for the service call
    const ids = products.map((p: any) => p.id);

    if (ids.length > 0) {
      await deactivateProducts(request, ids);

      const shop = settingsSession.shop;
      for (const product of products) {
        await db.activityLog.create({
          data: {
            shop,
            productId: product.id,
            productTitle: product.title,
            productSku: product.sku,
            method: "MANUAL",
            action: "DEACTIVATE",
          }
        });
      }
    }

    return { success: true, deactivatedCount: ids.length, ids };
  }

  if (actionType === "clearLogs") {
    await db.activityLog.deleteMany({
      where: { shop: settingsSession.shop }
    });
    return { success: true, clearedLogs: true };
  }

  if (actionType === "saveSettings") {
    const isActive = formData.get("isActive") === "true";
    const frequency = parseInt(formData.get("frequency") as string, 10);
    const frequencyUnit = formData.get("frequencyUnit") as string;
    const minDaysInactive = parseInt(formData.get("minDaysInactive") as string || "90", 10);

    await db.settings.upsert({
      where: { shop: settingsSession.shop },
      update: { isActive, frequency, frequencyUnit, minDaysInactive },
      create: { shop: settingsSession.shop, isActive, frequency, frequencyUnit, minDaysInactive }
    });

    return { success: true, savedSettings: true };
  }

  return null;
};

export default function Index() {
  const { stats, logs, productList, view, settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();

  const isLoading = navigation.state === "submitting" || navigation.state === "loading";
  const isScanning = isLoading && navigation.formData?.get("actionType") === "scan";
  const isDeactivating = isLoading && navigation.formData?.get("actionType") === "deactivate";

  // Settings State - typed correctly
  const typedSettings = settings as Settings | null;

  // Resolve items to display (Priority: 1. Action Data, 2. Persistent Manual, 3. Persistent Auto)
  // But strictly speaking, if actionData exists, it's a fresh manual scan.
  // If not, fall back to Settings.

  const persistentResults = typedSettings?.lastScanResults ? JSON.parse(typedSettings.lastScanResults) : [];
  const persistentType = typedSettings?.lastScanType; // 'AUTO' or 'MANUAL'

  // If actionData has candidates, we are in a fresh manual flow.
  // If not, check persistent storage.
  const activeCandidates = (actionData as any)?.candidates || [];
  const hasActiveCandidates = activeCandidates.length > 0;

  // If no fresh candidates, use persistent ones.
  const visibleItems = hasActiveCandidates ? activeCandidates : persistentResults;

  // Determine mode
  // If fresh candidates -> Manual Mode
  // If persistent AND type = MANUAL -> Manual Mode (continuing session)
  // If persistent AND type = AUTO -> Read Only Mode
  const isManualMode = hasActiveCandidates || (visibleItems.length > 0 && persistentType === 'MANUAL');
  const isReadonly = !isManualMode && visibleItems.length > 0 && persistentType === 'AUTO';

  // Selection state
  const {
    selectedResources: selectedCandidates,
    allResourcesSelected: allCandidatesSelected,
    handleSelectionChange: handleCandidateSelection,
    clearSelection: clearCandidateSelection
  } = useIndexResourceState(visibleItems);

  const initialIsActive = typedSettings?.isActive ?? false;

  const [autoEnabled, setAutoEnabled] = useState(initialIsActive ? 'true' : 'false');
  const [frequency, setFrequency] = useState(typedSettings?.frequency?.toString() || "1");
  const [frequencyUnit, setFrequencyUnit] = useState(typedSettings?.frequencyUnit || "days");
  const [autoMinDays, setAutoMinDays] = useState(typedSettings?.minDaysInactive?.toString() || "90");

  const [daysThreshold, setDaysThreshold] = useState("90");
  const [timeLeft, setTimeLeft] = useState("");
  const [progress, setProgress] = useState(0);

  // Polling for Auto Updates
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (autoEnabled === 'true') {
      // Poll every 5 seconds to check for new logs/updates
      interval = setInterval(() => {
        if (document.visibilityState === "visible") {
          revalidator.revalidate();
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [autoEnabled, revalidator]);

  const isSaving = isLoading && navigation.formData?.get("actionType") === "saveSettings";

  useEffect(() => {
    if ((actionData as any)?.savedSettings) {
      shopify.toast.show("Settings saved!");
    }
  }, [actionData, shopify]);

  const handleToggleAuto = (checked: boolean) => {
    const newVal = checked ? 'true' : 'false';
    setAutoEnabled(newVal);
    // If turning on, trigger immediate save
    submit({
      actionType: "saveSettings",
      isActive: newVal,
      frequency,
      frequencyUnit,
      minDaysInactive: autoMinDays
    }, { method: "POST" });
  };



  useEffect(() => {
    if ((actionData as any)?.deactivatedCount) {
      shopify.toast.show(`${(actionData as any).deactivatedCount} products deactivated`);
      clearCandidateSelection();
    }
  }, [actionData, shopify]);



  const handleScan = () => {
    submit({ actionType: "scan", days: daysThreshold }, { method: "POST" });
  };

  const handleDeactivate = () => {
    const selectedProducts = visibleItems
      .filter((item: any) => selectedCandidates.includes(item.id))
      .map((item: any) => ({
        id: item.id,
        title: item.title,
        sku: item.variants?.nodes?.[0]?.sku || ""
      }));

    submit({ actionType: "deactivate", selectedProducts: JSON.stringify(selectedProducts) }, { method: "POST" });
  };

  const handleClearLogs = () => {
    // Ideally add confirmation modal, but for now direct action as per request style (can add modal later if needed)
    // Actually, let's use a standard window.confirm for safety
    if (confirm("Are you sure you want to clear the activity history?")) {
      submit({ actionType: "clearLogs" }, { method: "POST" });
    }
  };

  // --- Render Helpers ---

  const getNextRunTime = () => {
    if (!typedSettings?.isActive || !typedSettings?.lastRunAt) return null;

    const lastRun = new Date(typedSettings.lastRunAt).getTime();
    let freqMs = 0;
    if (typedSettings.frequencyUnit === 'minutes') {
      freqMs = typedSettings.frequency * 60 * 1000;
    } else {
      freqMs = typedSettings.frequency * 24 * 60 * 60 * 1000;
    }

    return new Date(lastRun + freqMs);
  };

  const nextRun = getNextRunTime();

  // Countdown Timer Effect
  useEffect(() => {
    if (autoEnabled !== 'true' || !nextRun) {
      setTimeLeft("");
      setProgress(0);
      return;
    }

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const target = nextRun.getTime();
      const dist = target - now;

      if (dist < 0) {
        setTimeLeft("Running scan...");
        setProgress(100);
        return;
      }

      // Calculate time left components
      const days = Math.floor(dist / (1000 * 60 * 60 * 24));
      const hours = Math.floor((dist % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((dist % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((dist % (1000 * 60)) / 1000);

      let label = "";
      if (days > 0) label += `${days}d `;
      if (hours > 0 || days > 0) label += `${hours}h `;
      label += `${minutes}m ${seconds}s`;

      setTimeLeft(label);

      // Calculate progress percentage for visual bar (assuming cycle started at lastRunAt)
      if (typedSettings?.lastRunAt) {
        const start = new Date(typedSettings.lastRunAt).getTime();
        const totalDuration = target - start;
        const elapsed = now - start;
        const pct = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
        setProgress(pct);
      }

    }, 1000);

    return () => clearInterval(timer);
  }, [autoEnabled, nextRun, typedSettings]);

  const renderStatusCard = (count: number, label: string, statusKey: string) => (
    <RemixLink to={`?view=${statusKey}`} style={{ textDecoration: 'none' }}>
      <Card>
        <Box padding="400">
          <BlockStack>
            <Text as="h2" variant="headingLg">{count}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
          </BlockStack>
        </Box>
      </Card>
    </RemixLink>
  );

  const renderCandidateRow = (product: any, index: number) => (
    <IndexTable.Row
      id={product.id}
      key={product.id}
      selected={selectedCandidates.includes(product.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Thumbnail
          source={product.featuredImage?.url || ImageIcon}
          alt={product.title}
          size="small"
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodyMd" as="span">
          {product.title}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {product.sku}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="critical">{product.daysInactive?.toString()} days inactive</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>Active</IndexTable.Cell>
    </IndexTable.Row>
  );

  const renderProductListRow = (product: any, index: number) => {
    let tone: "success" | "info" | undefined = undefined;
    if (product.status === 'ACTIVE') tone = 'success';
    if (product.status === 'DRAFT') tone = 'info';
    // ARCHIVED defaults to undefined (Gray)

    const sku = product.variants?.nodes?.[0]?.sku || "";

    return (
      <IndexTable.Row
        id={product.id}
        key={product.id}
        selected={false} // No selection for now in list view
        position={index}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={product.featuredImage?.url || ImageIcon}
            alt={product.title}
            size="small"
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {product.title}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {sku}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {product.totalInventory}
        </IndexTable.Cell>
        <IndexTable.Cell><Badge tone={tone}>{product.status}</Badge></IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(product.updatedAt).toLocaleDateString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  };

  // --- Main Render ---

  if (view) {
    // LIST VIEW
    return (
      <Page fullWidth>
        <TitleBar title={`${view.charAt(0).toUpperCase() + view.slice(1)} Products`}>
          <button variant="breadcrumb" onClick={() => history.back()}>Dashboard</button>
        </TitleBar>
        <BlockStack gap="500">
          <RemixLink to=".">← Back to Dashboard</RemixLink>
          <Card>
            <IndexTable
              resourceName={{ singular: 'product', plural: 'products' }}
              itemCount={productList.length}
              selectedItemsCount={0}
              onSelectionChange={() => { }}
              headings={[
                { title: 'Image' },
                { title: 'Product' },
                { title: 'SKU' },
                { title: 'Inventory' },
                { title: 'Status' },
                { title: 'Last Update' },
              ]}
              selectable={false}
            >
              {productList.map(renderProductListRow)}
            </IndexTable>
          </Card>
        </BlockStack>
      </Page>
    );
  }

  // DASHBOARD VIEW
  return (
    <Page fullWidth>
      <TitleBar title="Inventory Deactivator" />
      <BlockStack gap="500">

        {/* Metrics Banner */}
        <Layout>
          <Layout.Section>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
              {renderStatusCard(stats.active, "Active Products", "active")}
              {renderStatusCard(stats.draft, "Drafts", "draft")}
              {renderStatusCard(stats.archived, "Archived", "archived")}
            </div>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      Scan for Old Stock
                    </Text>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Identify and deactivate products that have been out of stock for a long time.
                    </Text>
                    {typedSettings?.lastRunAt && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <BlockStack gap="100">
                          <Text as="span" variant="bodySm" tone="subdued">Last Scan:</Text>
                          <InlineStack gap="200" align="start" blockAlign="center">
                            <Text as="span" variant="bodyMd" fontWeight="bold">
                              {new Date(typedSettings.lastRunAt).toLocaleString()}
                            </Text>
                            <Badge tone={typedSettings.lastScanType === 'AUTO' ? 'magic' : 'attention'}>
                              {typedSettings.lastScanType === 'AUTO' ? 'Auto-Scan' : 'Manual Scan'}
                            </Badge>
                          </InlineStack>
                        </BlockStack>
                      </div>
                    )}
                  </BlockStack>
                  <InlineStack gap="300" align="end">
                    <div style={{ width: "150px" }}>
                      <TextField
                        label="Days Inactive"
                        type="number"
                        value={daysThreshold}
                        onChange={(value) => setDaysThreshold(value)}
                        autoComplete="off"
                        labelHidden
                        placeholder="Threshold"
                        suffix="days"
                        helpText="Older than"
                      />
                    </div>
                    <Box paddingBlockStart="050">
                      <Button variant="primary" onClick={handleScan} loading={isScanning} disabled={isDeactivating}>
                        Scan Now
                      </Button>
                    </Box>
                  </InlineStack>
                </div>

                {visibleItems.length > 0 && (
                  <BlockStack gap="400">
                    <Banner tone={isReadonly ? "info" : "warning"}>
                      {isReadonly
                        ? `Last Auto-Scan deactivated ${visibleItems.length} products.`
                        : `Found ${visibleItems.length} products eligible for deactivation. Select products to archive.`
                      }
                    </Banner>
                    <IndexTable
                      resourceName={{ singular: 'product', plural: 'products' }}
                      itemCount={visibleItems.length}
                      selectedItemsCount={
                        allCandidatesSelected ? 'All' : selectedCandidates.length
                      }
                      onSelectionChange={handleCandidateSelection}
                      selectable={!isReadonly}
                      headings={[
                        { title: 'Image' },
                        { title: 'Product' },
                        { title: 'SKU' },
                        { title: 'Inactive Time' },
                        { title: 'Status' },
                      ]}
                      promotedBulkActions={isReadonly ? [] : [
                        {
                          content: 'Deactivate Selected',
                          onAction: handleDeactivate,
                          // @ts-expect-error loading sometimes mismatches in types
                          loading: isDeactivating
                        },
                      ]}
                    >
                      {visibleItems.map(renderCandidateRow)}
                    </IndexTable>
                  </BlockStack>
                )}

                {actionData && (actionData as any).candidates && (actionData as any).candidates.length === 0 && (
                  <Banner tone="success">
                    No old stock found! Your inventory is healthy.
                  </Banner>
                )}

              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Settings Card */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Auto-Deactivate</Text>
                    <Checkbox
                      label="Enable"
                      labelHidden
                      checked={autoEnabled === 'true'}
                      onChange={handleToggleAuto}
                    // Use a toggle switch style if available via props or custom CSS,
                    // but standard Checkbox is the cleanest Polaris option for "Switch" in this context without extra deps.
                    // Actually, Polaris has a 'tone' or we can just use the toggle boolean.
                    />
                  </InlineStack>

                  <Text as="p" tone={autoEnabled === 'true' ? 'success' : 'subdued'}>
                    Status: {autoEnabled === 'true' ? 'Active' : 'Disabled'}
                  </Text>

                  {timeLeft && autoEnabled === 'true' && (
                    <div style={{ background: "var(--p-surface-subdued)", borderRadius: "8px", padding: "10px" }}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">Next Run</Text>
                          <Text as="span" variant="bodySm" fontWeight="bold">{timeLeft}</Text>
                        </InlineStack>
                        {/* Progress bar visual */}
                        <ProgressBar progress={progress} size="small" tone="success" />
                      </BlockStack>
                    </div>
                  )}

                  <BlockStack gap="300">
                    <TextField
                      label="Deactivate products after"
                      type="number"
                      value={autoMinDays}
                      onChange={setAutoMinDays}
                      autoComplete="off"
                      disabled={autoEnabled === 'true'}
                      suffix="days"
                      helpText="Inactive threshold"
                    />

                    <TextField
                      label="Run Scan Every"
                      type="number"
                      value={frequency}
                      onChange={setFrequency}
                      autoComplete="off"
                      disabled={autoEnabled === 'true'}
                      connectedRight={
                        <Select
                          label="Unit"
                          labelHidden
                          options={[
                            { label: 'Days', value: 'days' },
                            { label: 'Minutes', value: 'minutes' },
                          ]}
                          value={frequencyUnit}
                          onChange={setFrequencyUnit}
                          disabled={autoEnabled === 'true'}
                        />
                      }
                    />
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Recent Activity
                    </Text>
                    {logs.length > 0 && (
                      <Button variant="plain" tone="critical" onClick={handleClearLogs}>
                        Clear History
                      </Button>
                    )}
                  </InlineStack>
                  {logs.length === 0 ? (
                    <Text as="p" tone="subdued">No activity yet.</Text>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: 'log', plural: 'logs' }}
                      itemCount={logs.length}
                      selectedItemsCount={0}
                      onSelectionChange={() => { }}
                      headings={[
                        { title: 'Date & Time' },
                        { title: 'Action' },
                        { title: 'Method' },
                        { title: 'SKU' },
                        { title: 'Name' },
                        { title: 'ID' },
                      ]}
                      selectable={false}
                    >
                      {logs.map((log: any, index: number) => {
                        const product = log.productDetails;
                        const dateStr = new Date(log.createdAt).toLocaleString();

                        // Action Label
                        let actionLabel = log.action;
                        let badgeTone: "success" | "critical" | "info" | "attention" | "magic" = "info";
                        if (log.action === 'AUTO-DEACTIVATE') { actionLabel = 'Deactivated'; badgeTone = 'info'; }
                        else if (log.action === 'DEACTIVATE') { actionLabel = 'Deactivated'; badgeTone = 'info'; }
                        else if (log.action === 'REACTIVATE') { actionLabel = 'Reactivated'; badgeTone = 'success'; }

                        // Method Label
                        let methodLabel = log.method;

                        // Normalize Webhook/Auto to "Auto"
                        if (methodLabel === 'WEBHOOK' || methodLabel === 'AUTO') {
                          methodLabel = 'Auto';
                        } else if (methodLabel === 'MANUAL') {
                          methodLabel = 'Manual';
                        }

                        // Fallback for old logs
                        if (!methodLabel) {
                          if (log.action === 'AUTO-DEACTIVATE' || log.action === 'REACTIVATE') methodLabel = 'Auto';
                          else methodLabel = 'Manual';
                        }

                        const methodTone = methodLabel === 'Auto' ? 'magic' : 'info';


                        // SKU & Name
                        const sku = log.productSku || product?.variants?.nodes?.[0]?.sku || "-";
                        const name = log.productTitle || product?.title || "Unknown Product";
                        const id = log.productId;

                        return (
                          <IndexTable.Row id={log.id.toString()} key={log.id} position={index}>
                            <IndexTable.Cell>
                              {dateStr}
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Badge tone={badgeTone}>{actionLabel}</Badge>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Badge tone={methodTone}>{methodLabel}</Badge>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text variant="bodySm" as="span" fontWeight="bold">{sku}</Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text variant="bodyMd" as="span">{name}</Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text variant="bodySm" as="span" tone="subdued">{id.split("/").pop()}</Text>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        );
                      })}
                    </IndexTable>
                  )}
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
