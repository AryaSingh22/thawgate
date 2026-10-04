import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, getMint, getTokenMetadata } from "@solana/spl-token";

export function shortAddress(value?: string | null) {
    if (!value) return "-";
    return value.length > 12 ? `${value.slice(0, 5)}...${value.slice(-5)}` : value;
}

/** A PublicKey, or null when the text isn't one. */
export function parseKey(value: string): PublicKey | null {
    try {
        return new PublicKey(value.trim());
    } catch {
        return null;
    }
}

/** A readable message from a wallet, RPC or program error. Simulation failures keep their last log lines. */
export function errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return typeof error === "object" && error !== null ? JSON.stringify(error) : String(error);
    const logs = (error as { logs?: string[] }).logs;
    return logs?.length ? `${error.message}\n${logs.slice(-6).join("\n")}` : error.message;
}

/** localStorage, ignoring failures (private windows, blocked storage). */
export function loadJson<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

export function saveJson(key: string, value: unknown) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // not persisted; the page still works
    }
}

/** The last mint the wizard created or the holder view used. */
export const LAST_MINT_KEY = "thawgate.lastMint";

/** Base units as a token amount with thousands separators: formatUnits(1_234_500_000n, 6) = "1,234.5". */
export function formatUnits(value: bigint | { toString(): string }, decimals: number): string {
    const raw = BigInt(value.toString());
    const abs = raw < 0n ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${raw < 0n ? "-" : ""}${(abs / base).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** A token amount typed by a person ("1,000.5") in base units, or null if it isn't one or has too many decimals. */
export function parseUnits(text: string, decimals: number): bigint | null {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(text.replace(/[,_\s]/g, ""));
    if (!m || (m[2] ?? "").length > decimals) return null;
    return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
}

/** Unix seconds as "2026-10-04 13:51 UTC". */
export function utcTime(seconds: number | bigint): string {
    return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Seconds as "3 d 4 h", "4 h 7 min" or "52 s". */
export function duration(seconds: number | bigint): string {
    const s = Math.max(0, Math.floor(Number(seconds)));
    if (s < 60) return `${s} s`;
    const [d, h, m] = [Math.floor(s / 86_400), Math.floor((s % 86_400) / 3_600), Math.floor((s % 3_600) / 60)];
    if (d) return h ? `${d} d ${h} h` : `${d} d`;
    if (h) return m ? `${h} h ${m} min` : `${h} h`;
    return `${m} min`;
}

export interface MintInfo {
    supply: bigint;
    decimals: number;
    symbol: string;
    name: string;
}

/** A Token-2022 mint's supply and decimals, with its metadata symbol and name when it has them. */
export async function mintInfo(connection: Connection, mint: PublicKey): Promise<MintInfo> {
    const [account, metadata] = await Promise.all([
        getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID),
        getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null),
    ]);
    return { supply: account.supply, decimals: account.decimals, symbol: metadata?.symbol ?? "", name: metadata?.name ?? "" };
}

/** The owner's balance of a Token-2022 mint (its ATA), e.g. "0 tgUSD", or null when the account doesn't exist. */
export async function tokenBalance(connection: Connection, mint: PublicKey, owner: PublicKey): Promise<string | null> {
    const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
    const [balance, metadata] = await Promise.all([
        connection.getTokenAccountBalance(ata, "confirmed").catch(() => null),
        getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID).catch(() => null),
    ]);
    if (!balance) return null;
    return `${balance.value.uiAmountString ?? balance.value.amount} ${metadata?.symbol ?? ""}`.trim();
}
