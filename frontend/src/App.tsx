import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
    ConnectionProvider,
    WalletProvider,
    useConnection,
    useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_URL = import.meta.env.VITE_RPC_URL || clusterApiUrl("devnet");

const SERVICES = {
    mint: {
        label: "Mint API",
        baseUrl: import.meta.env.VITE_MINT_API_URL || "http://localhost:3001",
        healthPath: "/health",
    },
    indexer: {
        label: "Indexer",
        baseUrl: import.meta.env.VITE_INDEXER_API_URL || "http://localhost:3002",
        healthPath: "/health",
    },
    compliance: {
        label: "Compliance API",
        baseUrl: import.meta.env.VITE_COMPLIANCE_API_URL || "http://localhost:3003",
        healthPath: "/health",
    },
    webhook: {
        label: "Webhook API",
        baseUrl: import.meta.env.VITE_WEBHOOK_API_URL || "http://localhost:3004",
        healthPath: "/health",
    },
} as const;

type ServiceKey = keyof typeof SERVICES;
type TabId = "overview" | "operations" | "compliance" | "webhooks";
type RequestState = "idle" | "loading" | "success" | "error";

type ServiceHealth = {
    key: ServiceKey;
    label: string;
    url: string;
    status: "online" | "offline" | "checking";
    latencyMs?: number;
    detail?: string;
};

type SupplyData = {
    mint: string;
    totalMinted: string;
    totalBurned: string;
    currentSupply: string;
};

type AuditEntry = {
    action: string;
    actor?: string;
    target?: string | null;
    amount?: string | null;
    reason?: string | null;
    txSignature?: string;
    timestamp: string;
};

type BlacklistEntry = {
    target: string;
    operator?: string;
    reason?: string | null;
    txSignature?: string;
    timestamp?: string;
};

type WebhookSubscription = {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt?: string;
};

type IndexerStatus = {
    subscribed: boolean;
    programId: string;
    lastProcessedSlot: string;
    currentSlot: number;
    lag: number | null;
    eventsProcessed: number;
};

function shortAddress(value?: string | null) {
    if (!value) return "-";
    return value.length > 12 ? `${value.slice(0, 5)}...${value.slice(-5)}` : value;
}

function formatAmount(value?: string | null) {
    if (!value) return "0";
    try {
        return BigInt(value).toLocaleString("en-US");
    } catch {
        return value;
    }
}

function validatePublicKey(value: string, label: string) {
    try {
        new PublicKey(value);
        return "";
    } catch {
        return `${label} must be a valid Solana public key.`;
    }
}

async function fetchJson<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options?.headers ?? {}),
            },
            signal: controller.signal,
        });

        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};

        if (!response.ok || payload?.success === false) {
            throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
        }

        return payload as T;
    } finally {
        window.clearTimeout(timeout);
    }
}

function Dashboard() {
    const { publicKey, connected } = useWallet();
    const { connection } = useConnection();
    const [activeTab, setActiveTab] = useState<TabId>("overview");
    const [walletBalance, setWalletBalance] = useState<number | null>(null);
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

    useEffect(() => {
        if (!publicKey || !connection) {
            setWalletBalance(null);
            return;
        }

        connection
            .getBalance(publicKey)
            .then((balance) => setWalletBalance(balance / LAMPORTS_PER_SOL))
            .catch(() => setWalletBalance(null));
    }, [publicKey, connection]);

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
        <div className="app-shell">
            <header className="topbar">
                <div>
                    <p className="eyebrow">Solana Stablecoin Standard</p>
                    <h1>Operator Console</h1>
                </div>
                <div className="wallet-strip">
                    {connected && walletBalance !== null ? (
                        <span className="balance-pill">{walletBalance.toFixed(4)} SOL</span>
                    ) : null}
                    <WalletMultiButton className="wallet-button" />
                </div>
            </header>

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

function ServiceList({ services }: { services: ServiceHealth[] }) {
    return (
        <div className="service-list">
            <div className="section-label">Services</div>
            {services.map((service) => (
                <div key={service.key} className="service-row">
                    <span className={`status-dot ${service.status}`} />
                    <div>
                        <strong>{service.label}</strong>
                        <span>{service.latencyMs ? `${service.latencyMs} ms` : service.detail}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function Overview({
    auditLog,
    chartData,
    health,
    indexerStatus,
    supplyData,
}: {
    auditLog: AuditEntry[];
    chartData: { label: string; amount: number }[];
    health: ServiceHealth[];
    indexerStatus: IndexerStatus | null;
    supplyData: SupplyData | null;
}) {
    const online = health.filter((service) => service.status === "online").length;
    const stats = [
        { label: "Current supply", value: formatAmount(supplyData?.currentSupply) },
        { label: "Minted", value: formatAmount(supplyData?.totalMinted) },
        { label: "Burned", value: formatAmount(supplyData?.totalBurned) },
        { label: "Audit events", value: auditLog.length.toLocaleString("en-US") },
    ];

    return (
        <div className="stack">
            <div className="metric-grid">
                {stats.map((stat) => (
                    <article key={stat.label} className="metric-card">
                        <span>{stat.label}</span>
                        <strong>{stat.value}</strong>
                    </article>
                ))}
            </div>

            <div className="two-column">
                <section className="panel">
                    <div className="panel-heading">
                        <h2>Supply Position</h2>
                        <span className="muted mono">{supplyData ? shortAddress(supplyData.mint) : "No mint"}</span>
                    </div>
                    <div className="chart-box">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 4, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="supplyGradient" x1="0" x2="0" y1="0" y2="1">
                                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.55} />
                                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.04} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="#28303a" strokeDasharray="3 3" />
                                <XAxis dataKey="label" stroke="#8b949e" />
                                <YAxis stroke="#8b949e" />
                                <Tooltip
                                    contentStyle={{
                                        background: "#15191f",
                                        border: "1px solid #30363d",
                                        borderRadius: 8,
                                        color: "#f0f3f6",
                                    }}
                                />
                                <Area
                                    dataKey="amount"
                                    stroke="#14b8a6"
                                    strokeWidth={2}
                                    fill="url(#supplyGradient)"
                                    type="monotone"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </section>

                <section className="panel">
                    <div className="panel-heading">
                        <h2>Runtime</h2>
                        <span className={online === health.length ? "badge good" : "badge warn"}>
                            {online}/{health.length} online
                        </span>
                    </div>
                    <dl className="detail-list">
                        <div>
                            <dt>Indexer subscription</dt>
                            <dd>{indexerStatus?.subscribed ? "Active" : "Inactive"}</dd>
                        </div>
                        <div>
                            <dt>Current slot</dt>
                            <dd>{indexerStatus?.currentSlot?.toLocaleString("en-US") ?? "-"}</dd>
                        </div>
                        <div>
                            <dt>Indexer lag</dt>
                            <dd>{indexerStatus?.lag ?? "-"}</dd>
                        </div>
                        <div>
                            <dt>Events processed</dt>
                            <dd>{indexerStatus?.eventsProcessed?.toLocaleString("en-US") ?? "-"}</dd>
                        </div>
                    </dl>
                </section>
            </div>

            <AuditTable entries={auditLog.slice(0, 8)} />
        </div>
    );
}

function Operations({
    mintAddress,
    onComplete,
    setMessage,
}: {
    mintAddress: string;
    onComplete: () => void;
    setMessage: (message: string) => void;
}) {
    return (
        <div className="two-column top-align">
            <MintForm mintAddress={mintAddress} onComplete={onComplete} setMessage={setMessage} />
            <BurnForm mintAddress={mintAddress} onComplete={onComplete} setMessage={setMessage} />
        </div>
    );
}

function MintForm({
    mintAddress,
    onComplete,
    setMessage,
}: {
    mintAddress: string;
    onComplete: () => void;
    setMessage: (message: string) => void;
}) {
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [state, setState] = useState<RequestState>("idle");

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        const mintError = validatePublicKey(mintAddress, "Mint");
        const recipientError = validatePublicKey(recipient, "Recipient");
        if (mintError || recipientError) {
            setMessage(mintError || recipientError);
            return;
        }

        setState("loading");
        try {
            const payload = await fetchJson<{ signature: string; slot: number; amount: string }>(
                SERVICES.mint.baseUrl,
                "/mint",
                {
                    method: "POST",
                    body: JSON.stringify({ mintAddress, recipient, amount }),
                },
            );
            setState("success");
            setMessage(`Mint confirmed at slot ${payload.slot}: ${shortAddress(payload.signature)}`);
            setRecipient("");
            setAmount("");
            onComplete();
        } catch (error) {
            setState("error");
            setMessage(error instanceof Error ? error.message : "Mint failed.");
        }
    }

    return (
        <form className="panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
                <h2>Mint Tokens</h2>
                <span className="badge">Raw units</span>
            </div>
            <Field label="Recipient wallet">
                <input
                    className="input mono"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value.trim())}
                    placeholder="Wallet public key"
                />
            </Field>
            <Field label="Amount">
                <input
                    className="input"
                    min="1"
                    step="1"
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="1000000"
                />
            </Field>
            <button className="button primary fill" disabled={!mintAddress || !recipient || !amount || state === "loading"}>
                {state === "loading" ? "Submitting..." : "Submit mint"}
            </button>
        </form>
    );
}

function BurnForm({
    mintAddress,
    onComplete,
    setMessage,
}: {
    mintAddress: string;
    onComplete: () => void;
    setMessage: (message: string) => void;
}) {
    const [amount, setAmount] = useState("");
    const [state, setState] = useState<RequestState>("idle");

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        const mintError = validatePublicKey(mintAddress, "Mint");
        if (mintError) {
            setMessage(mintError);
            return;
        }

        setState("loading");
        try {
            const payload = await fetchJson<{ signature: string; slot: number; amount: string }>(
                SERVICES.mint.baseUrl,
                "/burn",
                {
                    method: "POST",
                    body: JSON.stringify({ mintAddress, amount }),
                },
            );
            setState("success");
            setMessage(`Burn confirmed at slot ${payload.slot}: ${shortAddress(payload.signature)}`);
            setAmount("");
            onComplete();
        } catch (error) {
            setState("error");
            setMessage(error instanceof Error ? error.message : "Burn failed.");
        }
    }

    return (
        <form className="panel form-panel" onSubmit={handleSubmit}>
            <div className="panel-heading">
                <h2>Burn Tokens</h2>
                <span className="badge danger">Supply reducing</span>
            </div>
            <Field label="Amount">
                <input
                    className="input"
                    min="1"
                    step="1"
                    type="number"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="1000000"
                />
            </Field>
            <button className="button danger fill" disabled={!mintAddress || !amount || state === "loading"}>
                {state === "loading" ? "Submitting..." : "Submit burn"}
            </button>
        </form>
    );
}

function Compliance({
    auditLog,
    blacklist,
    mintAddress,
    onRefresh,
    setMessage,
}: {
    auditLog: AuditEntry[];
    blacklist: BlacklistEntry[];
    mintAddress: string;
    onRefresh: () => void;
    setMessage: (message: string) => void;
}) {
    const [target, setTarget] = useState("");
    const [checkResult, setCheckResult] = useState<string | null>(null);
    const [state, setState] = useState<RequestState>("idle");

    async function checkWallet(event: FormEvent) {
        event.preventDefault();
        const mintError = validatePublicKey(mintAddress, "Mint");
        const targetError = validatePublicKey(target, "Wallet");
        if (mintError || targetError) {
            setMessage(mintError || targetError);
            return;
        }

        setState("loading");
        try {
            const payload = await fetchJson<{
                blacklisted: boolean;
                entry: { reason?: string | null; timestamp?: string } | null;
            }>(
                SERVICES.compliance.baseUrl,
                `/blacklist/${encodeURIComponent(mintAddress)}/${encodeURIComponent(target)}`,
            );
            setCheckResult(
                payload.blacklisted
                    ? `Blacklisted${payload.entry?.reason ? `: ${payload.entry.reason}` : ""}`
                    : "Clear",
            );
            setState("success");
        } catch (error) {
            setState("error");
            setMessage(error instanceof Error ? error.message : "Blacklist check failed.");
        }
    }

    return (
        <div className="stack">
            <div className="two-column top-align">
                <form className="panel form-panel" onSubmit={checkWallet}>
                    <div className="panel-heading">
                        <h2>Wallet Screening</h2>
                        <span className={checkResult === "Clear" ? "badge good" : "badge"}>{checkResult || state}</span>
                    </div>
                    <Field label="Wallet address">
                        <input
                            className="input mono"
                            value={target}
                            onChange={(event) => setTarget(event.target.value.trim())}
                            placeholder="Wallet public key"
                        />
                    </Field>
                    <button className="button primary fill" disabled={!mintAddress || !target || state === "loading"}>
                        Check wallet
                    </button>
                </form>

                <section className="panel">
                    <div className="panel-heading">
                        <h2>Active Blacklist</h2>
                        <button className="button slim" onClick={onRefresh}>Refresh</button>
                    </div>
                    <div className="table-wrap compact">
                        <table>
                            <thead>
                                <tr>
                                    <th>Wallet</th>
                                    <th>Reason</th>
                                    <th>Operator</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blacklist.length ? (
                                    blacklist.map((entry) => (
                                        <tr key={`${entry.target}-${entry.txSignature ?? entry.timestamp}`}>
                                            <td className="mono">{shortAddress(entry.target)}</td>
                                            <td>{entry.reason || "-"}</td>
                                            <td className="mono">{shortAddress(entry.operator)}</td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={3} className="empty-cell">No active blacklist entries</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            <AuditTable entries={auditLog} />
        </div>
    );
}

function Webhooks({
    mintAddress,
    onRefresh,
    setMessage,
    subscriptions,
}: {
    mintAddress: string;
    onRefresh: () => void;
    setMessage: (message: string) => void;
    subscriptions: WebhookSubscription[];
}) {
    const [url, setUrl] = useState("");
    const [events, setEvents] = useState("MINT,BURN,BLACKLIST_ADD,SEIZE");
    const [state, setState] = useState<RequestState>("idle");

    async function registerWebhook(event: FormEvent) {
        event.preventDefault();
        setState("loading");
        try {
            const payload = await fetchJson<{ data: WebhookSubscription & { secret?: string } }>(
                SERVICES.webhook.baseUrl,
                "/subscriptions",
                {
                    method: "POST",
                    body: JSON.stringify({
                        url,
                        events: events.split(",").map((item) => item.trim()).filter(Boolean),
                        stablecoinMint: mintAddress || undefined,
                    }),
                },
            );
            setState("success");
            setUrl("");
            setMessage(`Webhook registered. Secret shown once: ${payload.data.secret || "hidden"}`);
            onRefresh();
        } catch (error) {
            setState("error");
            setMessage(error instanceof Error ? error.message : "Webhook registration failed.");
        }
    }

    return (
        <div className="two-column top-align">
            <form className="panel form-panel" onSubmit={registerWebhook}>
                <div className="panel-heading">
                    <h2>Register Webhook</h2>
                    <span className="badge">{state}</span>
                </div>
                <Field label="Endpoint URL">
                    <input
                        className="input"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://example.com/sss-events"
                    />
                </Field>
                <Field label="Events">
                    <input
                        className="input mono"
                        value={events}
                        onChange={(event) => setEvents(event.target.value)}
                    />
                </Field>
                <button className="button primary fill" disabled={!url || !events || state === "loading"}>
                    Register
                </button>
            </form>

            <section className="panel">
                <div className="panel-heading">
                    <h2>Active Webhooks</h2>
                    <button className="button slim" onClick={onRefresh}>Refresh</button>
                </div>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Endpoint</th>
                                <th>Events</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {subscriptions.length ? (
                                subscriptions.map((subscription) => (
                                    <tr key={subscription.id}>
                                        <td>{subscription.url}</td>
                                        <td>{subscription.events.join(", ")}</td>
                                        <td>{subscription.active ? "Active" : "Inactive"}</td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={3} className="empty-cell">No active webhooks</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
    return (
        <section className="panel">
            <div className="panel-heading">
                <h2>Audit Trail</h2>
                <span className="muted">{entries.length} entries</span>
            </div>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Action</th>
                            <th>Actor</th>
                            <th>Target</th>
                            <th>Amount</th>
                            <th>Signature</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.length ? (
                            entries.map((entry, index) => (
                                <tr key={`${entry.txSignature ?? entry.timestamp}-${index}`}>
                                    <td><span className="badge">{entry.action}</span></td>
                                    <td className="mono">{shortAddress(entry.actor)}</td>
                                    <td className="mono">{shortAddress(entry.target)}</td>
                                    <td>{formatAmount(entry.amount)}</td>
                                    <td className="mono">{shortAddress(entry.txSignature)}</td>
                                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={6} className="empty-cell">No audit entries loaded</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
    return (
        <label className="field">
            <span>{label}</span>
            {children}
        </label>
    );
}

export default function App() {
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

    return (
        <ConnectionProvider endpoint={RPC_URL}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <Dashboard />
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
