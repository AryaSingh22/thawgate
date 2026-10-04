// The legacy SSS service APIs behind /ops (moved out of the old single App.tsx in S13, behaviour unchanged).
import { PublicKey } from "@solana/web3.js";

export const SERVICES = {
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

export type ServiceKey = keyof typeof SERVICES;
export type TabId = "overview" | "operations" | "compliance" | "webhooks";
export type RequestState = "idle" | "loading" | "success" | "error";

export type ServiceHealth = {
    key: ServiceKey;
    label: string;
    url: string;
    status: "online" | "offline" | "checking";
    latencyMs?: number;
    detail?: string;
};

export type SupplyData = {
    mint: string;
    totalMinted: string;
    totalBurned: string;
    currentSupply: string;
};

export type AuditEntry = {
    action: string;
    actor?: string;
    target?: string | null;
    amount?: string | null;
    reason?: string | null;
    txSignature?: string;
    timestamp: string;
};

export type BlacklistEntry = {
    target: string;
    operator?: string;
    reason?: string | null;
    txSignature?: string;
    timestamp?: string;
};

export type WebhookSubscription = {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt?: string;
};

export type IndexerStatus = {
    subscribed: boolean;
    programId: string;
    lastProcessedSlot: string;
    currentSlot: number;
    lag: number | null;
    eventsProcessed: number;
};

export function formatAmount(value?: string | null) {
    if (!value) return "0";
    try {
        return BigInt(value).toLocaleString("en-US");
    } catch {
        return value;
    }
}

export function validatePublicKey(value: string, label: string) {
    try {
        new PublicKey(value);
        return "";
    } catch {
        return `${label} must be a valid Solana public key.`;
    }
}

export async function fetchJson<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
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
