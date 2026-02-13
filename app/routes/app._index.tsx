import { useEffect, useState, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit, useNavigation, useSearchParams, Link as RemixLink, useRevalidator, useFetcher } from "@remix-run/react";
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
  lastScanType?: string;
  lastScanResults?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const view = url.searchParams.get("view"); // 'active', 'draft', 'archived'

  // 1. Fetch Metrics (Always needed for the top bar if we want it persistent, or just for dashboard)
  let stats = { active: 0, draft: 0, archived: 0, activeNoStock: 0, inactiveWithStock: 0 };
  let productList = [];

  if (!view) {
    const queries = [
      { label: "active", query: "status:active" },
      { label: "draft", query: "status:draft" },
      { label: "archived", query: "status:archived" },
      { label: "activeNoStock", query: "status:active AND inventory_total:<=0" },
      { label: "inactiveWithStock", query: "(status:draft OR status:archived) AND inventory_total:>0" }
    ].map((item) =>
      admin.graphql(
        `query CountProducts($query: String) {
            productsCount(query: $query) {
              count
            }
          }`,
        { variables: { query: item.query } }
      ).then(res => res.json())
    );

    const results = await Promise.all(queries);

    stats = {
      active: (results[0] as any).data?.productsCount?.count || 0,
      draft: (results[1] as any).data?.productsCount?.count || 0,
      archived: (results[2] as any).data?.productsCount?.count || 0,
      activeNoStock: (results[3] as any).data?.productsCount?.count || 0,
      inactiveWithStock: (results[4] as any).data?.productsCount?.count || 0,
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
  const { stats: initialStats, logs, productList, view, settings } = useLoaderData<typeof loader>();
  const statsFetcher = useFetcher<any>();
  const currentStats = statsFetcher.data?.stats || initialStats;
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

  // Polling for Real-time Stats
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && statsFetcher.state === "idle") {
        statsFetcher.load("/api/stats");
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [statsFetcher]);

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
      shopify.toast.show(`${(actionData as any).deactivatedCount} products changed to Draft`);
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
        <Badge tone="critical">{`${(product.daysInactive || 0)} days inactive`}</Badge>
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
              {renderStatusCard(currentStats.active, "Active Products", "active")}
              {renderStatusCard(currentStats.draft, "Drafts", "draft")}
              {renderStatusCard(currentStats.archived, "Archived", "archived")}
              {renderStatusCard(currentStats.activeNoStock, "Active (No Stock)", "activeNoStock")}
              {renderStatusCard(currentStats.inactiveWithStock, "Inactive (Has Stock)", "inactiveWithStock")}
            </div>
          </Layout.Section>
        </Layout>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Welcome to Inventory Deactivator</Text>
                <Text as="p" variant="bodyMd">
                  Your automated assistant for keeping inventory clean and organized.
                </Text>
                <InlineStack gap="300">
                  <Button url="/app/manual">Go to Manual Scan</Button>
                  <Button url="/app/settings">Configure Auto-Deactivate</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
