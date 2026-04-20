import { IndexTable, Badge, Text, Thumbnail, InlineStack } from "@shopify/polaris";

type BadgeTone = "success" | "critical" | "info" | "attention" | "magic";

export type CurrentProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED" | "DELETED" | "UNKNOWN";

export interface ActivityLogEntry {
    id: number | string;
    createdAt: Date | string;
    action: string;
    method: string | null;
    productId: string;
    productSku: string | null;
    productTitle: string | null;
    productImageUrl: string | null;
    currentStatus?: CurrentProductStatus | null;
}

interface ActivityLogTableProps {
    logs: ActivityLogEntry[];
    /** Label shown for DEACTIVATE / AUTO-DEACTIVATE rows. Each page phrases this differently. */
    deactivatedLabel: string;
    /** When a log row has no `method`, derive one from the action (AUTO-DEACTIVATE/REACTIVATE → Auto, else Manual). */
    applyMethodFallback?: boolean;
    /** Render "Just Now" instead of "Invalid Date" — used by manual scan's optimistic rows whose timestamps round-trip through JSON. */
    handleInvalidDate?: boolean;
    /** Render a "Current Status" column reflecting the product's live Shopify status. Caller must populate `currentStatus` on each entry. */
    showCurrentStatus?: boolean;
}

function renderCurrentStatus(status: CurrentProductStatus | null | undefined) {
    switch (status) {
        case 'ACTIVE': return <Badge tone="success">Active</Badge>;
        case 'DRAFT': return <Badge tone="info">Draft</Badge>;
        case 'ARCHIVED': return <Badge>Archived</Badge>;
        case 'DELETED': return <Badge tone="critical">Deleted</Badge>;
        default: return <Badge>Unknown</Badge>;
    }
}

export function ActivityLogTable({
    logs,
    deactivatedLabel,
    applyMethodFallback = false,
    handleInvalidDate = false,
    showCurrentStatus = false,
}: ActivityLogTableProps) {
    return (
        <IndexTable
            resourceName={{ singular: 'log', plural: 'logs' }}
            itemCount={logs.length}
            selectedItemsCount={0}
            onSelectionChange={() => { }}
            headings={[
                { title: 'Date & Time' },
                { title: 'Action' },
                { title: 'Method' },
                ...(showCurrentStatus ? [{ title: 'Current Status' }] : []),
                { title: 'SKU' },
                { title: 'Name' },
                { title: 'ID' },
            ]}
            selectable={false}
        >
            {logs.map((log, index) => {
                const dateStr = new Date(log.createdAt).toLocaleString();
                const displayDate = handleInvalidDate && dateStr === "Invalid Date" ? "Just Now" : dateStr;

                let actionLabel = log.action;
                let badgeTone: BadgeTone = "info";
                if (log.action === 'AUTO-DEACTIVATE') { actionLabel = deactivatedLabel; badgeTone = 'info'; }
                else if (log.action === 'DEACTIVATE') { actionLabel = deactivatedLabel; badgeTone = 'info'; }
                else if (log.action === 'REACTIVATE') { actionLabel = 'Reactivated'; badgeTone = 'success'; }

                let methodLabel: string | null = log.method;
                let methodTone: BadgeTone = "subdued" as BadgeTone;

                if (methodLabel === 'WEBHOOK' || methodLabel === 'AUTO') {
                    methodLabel = 'Auto';
                    methodTone = 'magic';
                } else if (methodLabel === 'MANUAL') {
                    methodLabel = 'Manual';
                    methodTone = 'attention';
                }
                if (applyMethodFallback && !methodLabel) {
                    if (log.action === 'AUTO-DEACTIVATE' || log.action === 'REACTIVATE') {
                        methodLabel = 'Auto';
                        methodTone = 'magic';
                    } else {
                        methodLabel = 'Manual';
                        methodTone = 'attention';
                    }
                }

                const image = log.productImageUrl;
                const sku = log.productSku || "-";
                const name = log.productTitle || "Unknown Product";
                const id = log.productId;

                return (
                    <IndexTable.Row id={log.id.toString()} key={log.id} position={index}>
                        <IndexTable.Cell>{displayDate}</IndexTable.Cell>
                        <IndexTable.Cell>
                            <Badge tone={badgeTone}>{actionLabel}</Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <Badge tone={methodTone}>{methodLabel ?? ''}</Badge>
                        </IndexTable.Cell>
                        {showCurrentStatus && (
                            <IndexTable.Cell>
                                {renderCurrentStatus(log.currentStatus)}
                            </IndexTable.Cell>
                        )}
                        <IndexTable.Cell>
                            <Text variant="bodySm" as="span" fontWeight="bold">{sku}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <InlineStack gap="300" blockAlign="start" wrap={false}>
                                <div>
                                    {image ? (
                                        <Thumbnail source={image} alt={name} size="small" />
                                    ) : (
                                        <div style={{ width: 40, height: 40, background: "#f1f1f1", borderRadius: 4 }}></div>
                                    )}
                                </div>
                                <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word", whiteSpace: "normal" }}>
                                    <Text variant="bodyMd" as="span">{name}</Text>
                                </div>
                            </InlineStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                            <Text variant="bodySm" as="span" tone="subdued">{id.split("/").pop()}</Text>
                        </IndexTable.Cell>
                    </IndexTable.Row>
                );
            })}
        </IndexTable>
    );
}
