// The legacy SSS operator panels (S13 moved them here from the single App.tsx; behaviour unchanged). They call the
// mint-service, indexer, compliance-service and webhook-service HTTP APIs; the console's own flows use the SDK.
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { shortAddress } from "../../lib";
import {
    AuditEntry,
    BlacklistEntry,
    IndexerStatus,
    SERVICES,
    ServiceHealth,
    ServiceKey,
    SupplyData,
    TabId,
    WebhookSubscription,
    fetchJson,
    validatePublicKey,
} from "./api";
import { Compliance, Operations, Overview, ServiceList, Webhooks } from "./panels";

export function OpsPage() {
    const [activeTab, setActiveTab] = useState<TabId>("overview");
    const [mintAddress, setMintAddress] = useState(() => localStorage.getItem("sss.mintAddress") || "");
    const [health, setHealth] = useState<ServiceHealth[]>(() =>
        Object.entries(SERVICES).map(([key, service]) => ({
            key: key as ServiceKey,
            label: service.label,
            url: service.baseUrl,
            status: "checking",
        })),
    );
    const [supplyData, setSupplyData] = useState<SupplyData | null>(null);
    const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
    const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
    const [webhooks, setWebhooks] = useState<WebhookSubscription[]>([]);
    const [indexerStatus, setIndexerStatus] = useState<IndexerStatus | null>(null);
    const [lastMessage, setLastMessage] = useState("");

    const refreshHealth = useCallback(async () => {
        const checks = await Promise.all(
            Object.entries(SERVICES).map(async ([key, service]) => {
                const started = performance.now();
                try {
                    const payload = await fetchJson<{ service?: string; status?: string }>(
                        service.baseUrl,
                        service.healthPath,
                    );
                    return {
                        key: key as ServiceKey,
                        label: service.label,
                        url: service.baseUrl,
                        status: "online" as const,
                        latencyMs: Math.max(1, Math.round(performance.now() - started)),
                        detail: payload.service || payload.status || "ok",
                    };
                } catch (error) {
                    return {
                        key: key as ServiceKey,
                        label: service.label,
                        url: service.baseUrl,
                        status: "offline" as const,
                        detail: error instanceof Error ? error.message : "unreachable",
                    };
                }
            }),
        );
        setHealth(checks);
    }, []);

    const refreshMintData = useCallback(async () => {
        if (!mintAddress.trim()) {
            setSupplyData(null);
            setAuditLog([]);
            setBlacklist([]);
            return;
        }

        const mintError = validatePublicKey(mintAddress, "Mint");
        if (mintError) {
            setLastMessage(mintError);
            return;
        }

        localStorage.setItem("sss.mintAddress", mintAddress);

        const [supply, audit, blacklistData] = await Promise.allSettled([
            fetchJson<{ data: SupplyData }>(
                SERVICES.mint.baseUrl,
                `/supply/${encodeURIComponent(mintAddress)}`,
            ),
            fetchJson<{ data: AuditEntry[] }>(
                SERVICES.compliance.baseUrl,
                `/audit/${encodeURIComponent(mintAddress)}`,
            ),
            fetchJson<{ data: BlacklistEntry[] }>(
                SERVICES.compliance.baseUrl,
                `/blacklist/${encodeURIComponent(mintAddress)}`,
            ),
        ]);

        if (supply.status === "fulfilled") {
            setSupplyData(supply.value.data);
        }
        if (audit.status === "fulfilled") {
            setAuditLog(audit.value.data);
        }
        if (blacklistData.status === "fulfilled") {
            setBlacklist(blacklistData.value.data);
        }

        const failed = [supply, audit, blacklistData].filter((result) => result.status === "rejected");
        setLastMessage(
            failed.length
                ? "Some data sources are unavailable. Service health has the details."
                : `Loaded operator data for ${shortAddress(mintAddress)}.`,
        );
    }, [mintAddress]);

    const refreshWebhooks = useCallback(async () => {
        try {
            const payload = await fetchJson<{ data: WebhookSubscription[] }>(
                SERVICES.webhook.baseUrl,
                "/subscriptions",
            );
            setWebhooks(payload.data);
        } catch (error) {
            setLastMessage(error instanceof Error ? error.message : "Failed to load webhooks.");
        }
    }, []);

    const refreshIndexer = useCallback(async () => {
        try {
            const payload = await fetchJson<IndexerStatus>(SERVICES.indexer.baseUrl, "/status");
            setIndexerStatus(payload);
        } catch {
            setIndexerStatus(null);
        }
    }, []);

    useEffect(() => {
        refreshHealth();
        refreshIndexer();
        refreshWebhooks();
    }, [refreshHealth, refreshIndexer, refreshWebhooks]);

    const chartData = useMemo(() => {
        const minted = Number(supplyData?.totalMinted ?? 0);
        const burned = Number(supplyData?.totalBurned ?? 0);
        const supply = Number(supplyData?.currentSupply ?? 0);

        return [
            { label: "Minted", amount: Number.isFinite(minted) ? minted : 0 },
            { label: "Burned", amount: Number.isFinite(burned) ? burned : 0 },
            { label: "Supply", amount: Number.isFinite(supply) ? supply : 0 },
        ];
    }, [supplyData]);

    const tabs = [
        { id: "overview" as const, label: "Overview" },
        { id: "operations" as const, label: "Mint and Burn" },
        { id: "compliance" as const, label: "Compliance" },
        { id: "webhooks" as const, label: "Webhooks" },
    ];

    return (
        <div>
            <div className="notice">Legacy SSS service panels. They need the docker compose services running; the issuer and holder flows don't.</div>

            <section className="control-band">
                <div className="field grow">
                    <label htmlFor="mint-address">Mint address</label>
                    <input
                        id="mint-address"
                        className="input mono"
                        value={mintAddress}
                        onChange={(event) => setMintAddress(event.target.value.trim())}
                        placeholder="Token-2022 mint public key"
                    />
                </div>
                <button className="button primary" onClick={refreshMintData}>
                    Refresh
                </button>
                <button className="button" onClick={refreshHealth}>
                    Check services
                </button>
            </section>

            {lastMessage ? <div className="notice">{lastMessage}</div> : null}

            <div className="layout-grid">
                <aside className="sidebar">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            className={activeTab === tab.id ? "nav-item active" : "nav-item"}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                    <ServiceList services={health} />
                </aside>

                <main className="content">
                    {activeTab === "overview" ? (
                        <Overview
                            auditLog={auditLog}
                            chartData={chartData}
                            health={health}
                            indexerStatus={indexerStatus}
                            supplyData={supplyData}
                        />
                    ) : null}
                    {activeTab === "operations" ? (
                        <Operations
                            mintAddress={mintAddress}
                            onComplete={() => {
                                refreshMintData();
                                refreshHealth();
                            }}
                            setMessage={setLastMessage}
                        />
                    ) : null}
                    {activeTab === "compliance" ? (
                        <Compliance
                            auditLog={auditLog}
                            blacklist={blacklist}
                            mintAddress={mintAddress}
                            onRefresh={refreshMintData}
                            setMessage={setLastMessage}
                        />
                    ) : null}
                    {activeTab === "webhooks" ? (
                        <Webhooks
                            mintAddress={mintAddress}
                            subscriptions={webhooks}
                            onRefresh={refreshWebhooks}
                            setMessage={setLastMessage}
                        />
                    ) : null}
                </main>
            </div>
        </div>
    );
}
